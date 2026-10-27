import { execFileSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import type { WebSocket } from "ws";
import { adb, spawnAdb } from "./adb.ts";

/*
 * Live screen mirroring through scrcpy's device-side server (no app on the watch).
 * Wire format follows scrcpy 5.x: app/src/demuxer.c and app/src/control_msg.c.
 *
 * To the browser:  text  {"type":"size",width,height} | {"type":"error",message}
 *                  binary [flags:u8][H.264 Annex-B packet]   flags: 1 = config, 2 = key frame
 * From the browser: JSON {t:"touch",a,x,y} | {t:"scroll",x,y,h,v} | {t:"key",code} | {t:"back"}
 */

const SCRCPY_VERSION = "5.0.1";

function findServerJar() {
  const candidates = [process.env.SCRCPY_SERVER_PATH, "/opt/homebrew/share/scrcpy/scrcpy-server", "/usr/local/share/scrcpy/scrcpy-server"];
  try {
    candidates.push(`${execFileSync("brew", ["--prefix", "scrcpy"]).toString().trim()}/share/scrcpy/scrcpy-server`);
  } catch {
    /* brew not available */
  }
  return candidates.find((p) => p && existsSync(p));
}

/** One session per watch: a new viewer replaces the old one once it has fully exited. */
const active = new Map<string, { stop: () => void; done: Promise<void> }>();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Buffered socket reader that resolves exact byte counts. */
class Reader {
  private chunks: Buffer[] = [];
  private size = 0;
  private waiting: (() => void) | null = null;
  private ended = false;

  constructor(socket: net.Socket) {
    socket.on("data", (d) => {
      this.chunks.push(d);
      this.size += d.length;
      this.waiting?.();
    });
    const end = () => {
      this.ended = true;
      this.waiting?.();
    };
    socket.on("end", end);
    socket.on("close", end);
    socket.on("error", end);
  }

  async read(n: number): Promise<Buffer> {
    while (this.size < n) {
      if (this.ended) throw new Error("EOF");
      await new Promise<void>((r) => (this.waiting = r));
      this.waiting = null;
    }
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.size = rest.length;
    return out;
  }
}

function connect(port: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}

/** With adb forward, connect succeeds before the server listens; the dummy byte proves it's really there. */
async function connectVideo(port: number, isAlive: () => boolean) {
  for (let i = 0; i < 100 && isAlive(); i++) {
    const s = await connect(port).catch(() => null);
    if (s) {
      const r = new Reader(s);
      const ok = await r.read(1).then(() => true, () => false);
      if (ok) return { socket: s, reader: r };
      s.destroy();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("سرور نمایش روی ساعت اجرا نشد.");
}

/* --------------------------- control serialization -------------------------- */

const SC_POINTER_ID_GENERIC_FINGER = -2n;

interface Size {
  width: number;
  height: number;
}

function touchMsg(action: number, x: number, y: number, size: Size) {
  const b = Buffer.alloc(32);
  b[0] = 2; // INJECT_TOUCH_EVENT
  b[1] = action;
  b.writeBigInt64BE(SC_POINTER_ID_GENERIC_FINGER, 2);
  b.writeInt32BE(Math.round(x), 10);
  b.writeInt32BE(Math.round(y), 14);
  b.writeUInt16BE(size.width, 18);
  b.writeUInt16BE(size.height, 20);
  b.writeUInt16BE(action === 1 ? 0 : 0xffff, 22); // pressure
  b.writeUInt32BE(0, 24); // action button
  b.writeUInt32BE(0, 28); // buttons
  return b;
}

const i16fp = (v: number) => Math.max(-0x8000, Math.min(0x7fff, Math.round(Math.max(-1, Math.min(1, v / 16)) * 0x8000)));

function scrollMsg(x: number, y: number, h: number, v: number, size: Size) {
  const b = Buffer.alloc(21);
  b[0] = 3; // INJECT_SCROLL_EVENT
  b.writeInt32BE(Math.round(x), 1);
  b.writeInt32BE(Math.round(y), 5);
  b.writeUInt16BE(size.width, 9);
  b.writeUInt16BE(size.height, 11);
  b.writeInt16BE(i16fp(h), 13);
  b.writeInt16BE(i16fp(v), 15);
  b.writeUInt32BE(0, 17);
  return b;
}

function keyMsg(action: number, keycode: number) {
  const b = Buffer.alloc(14);
  b[0] = 0; // INJECT_KEYCODE
  b[1] = action;
  b.writeUInt32BE(keycode, 2);
  b.writeUInt32BE(0, 6);
  b.writeUInt32BE(0, 10);
  return b;
}

const backMsg = (action: number) => Buffer.from([4, action]); // BACK_OR_SCREEN_ON

/* --------------------------------- session -------------------------------- */

export async function runMirror(serial: string, ws: WebSocket) {
  const prev = active.get(serial);
  if (prev) {
    prev.stop();
    await prev.done;
  }
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  let closed = false;
  let proc: ChildProcess | undefined;
  let video: net.Socket | undefined;
  let control: net.Socket | undefined;
  let port = 0;
  const size: Size = { width: 0, height: 0 };

  const sendJson = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
  const cleanup = () => {
    if (closed) return;
    closed = true;
    video?.destroy();
    control?.destroy();
    proc?.kill();
    if (port) adb(["-s", serial, "forward", "--remove", `tcp:${port}`]).catch(() => {});
    if (ws.readyState === ws.OPEN) ws.close();
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
  active.set(serial, { stop: cleanup, done });
  if (ws.readyState !== ws.OPEN) {
    cleanup();
    finish();
    return;
  }

  try {
    const jar = findServerJar();
    if (!jar) throw new Error("scrcpy نصب نیست. با دستور brew install scrcpy نصبش کنید.");
    const scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, "0");
    // scrcpy deletes its own jar on exit (cleanup=true), so every session pushes a private copy.
    const deviceJar = `/data/local/tmp/scrcpy-server-${scid}.jar`;
    await adb(["-s", serial, "push", jar, deviceJar], 60_000);
    if (closed) return;
    port = await freePort();
    await adb(["-s", serial, "forward", `tcp:${port}`, `localabstract:scrcpy_${scid}`]);

    proc = spawnAdb([
      "-s", serial, "shell",
      `CLASSPATH=${deviceJar}`, "app_process", "/", "com.genymobile.scrcpy.Server", SCRCPY_VERSION,
      `scid=${scid}`, "log_level=warn", "audio=false", "tunnel_forward=true",
      "max_size=450", "max_fps=30", "video_codec=h264", "video_bit_rate=3000000",
      "clipboard_autosync=false", "power_on=true", "cleanup=true",
    ]);
    let stderr = "";
    proc.stdout?.on("data", (d) => (stderr += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("exit", () => {
      // Give the device-side server a moment to release the display/encoder.
      setTimeout(finish, 300);
      if (stderr.trim()) console.warn(`[mirror ${serial}]`, stderr.trim().slice(-500));
      if (!closed) {
        sendJson({ type: "error", message: /ERROR|Exception/.test(stderr) ? stderr.trim().split("\n").slice(-3).join(" ") : "نمایش زنده متوقف شد." });
        cleanup();
      }
    });

    const v = await connectVideo(port, () => !closed);
    video = v.socket;
    control = await connect(port);
    control.on("data", () => {}); // device → client messages (clipboard…) are not used
    control.on("error", cleanup);
    video.on("close", cleanup);

    await v.reader.read(64); // device name
    const codec = (await v.reader.read(4)).toString("latin1");
    if (codec !== "h264") throw new Error(`کدک ناشناخته: ${codec}`);

    ws.on("message", (raw) => {
      if (!control || size.width === 0) return;
      let m: { t: string; a?: number; x?: number; y?: number; h?: number; v?: number; code?: number };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.t === "touch") control.write(touchMsg(m.a ?? 0, m.x ?? 0, m.y ?? 0, size));
      else if (m.t === "scroll") control.write(scrollMsg(m.x ?? 0, m.y ?? 0, m.h ?? 0, m.v ?? 0, size));
      else if (m.t === "key" && Number.isInteger(m.code)) {
        control.write(keyMsg(0, m.code!));
        control.write(keyMsg(1, m.code!));
      } else if (m.t === "back") {
        control.write(backMsg(0));
        control.write(backMsg(1));
      }
    });

    for (;;) {
      const header = await v.reader.read(12);
      if (header[0] & 0x80) {
        // session packet: (re)announces the video size
        size.width = header.readUInt32BE(4);
        size.height = header.readUInt32BE(8);
        sendJson({ type: "size", width: size.width, height: size.height });
        continue;
      }
      const flagsHi = header[0];
      const len = header.readUInt32BE(8);
      const data = await v.reader.read(len);
      const flags = (flagsHi & 0x40 ? 1 : 0) | (flagsHi & 0x20 ? 2 : 0);
      if (ws.readyState !== ws.OPEN) break;
      ws.send(Buffer.concat([Buffer.from([flags]), data]));
    }
  } catch (e) {
    if (!closed) sendJson({ type: "error", message: (e as Error).message === "EOF" ? "ارتباط با ساعت قطع شد." : (e as Error).message });
  } finally {
    cleanup();
    if (!proc || proc.exitCode !== null) finish();
    if (active.get(serial)?.done === done) active.delete(serial);
  }
}

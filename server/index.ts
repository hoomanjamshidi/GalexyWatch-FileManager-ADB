import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import * as adb from "./adb.ts";
import { runMirror } from "./mirror.ts";

const PORT = Number(process.env.WATCH_DRIVE_API_PORT) || 4590;
const app = express();
app.use(express.json());

const SERIAL_RE = /^[\w.:\-]+$/;
const HOST_RE = /^[\w.\-]+$/;

function serialOf(req: Request) {
  const s = String(req.query.serial ?? req.body?.serial ?? "");
  if (!SERIAL_RE.test(s)) throw new adb.AdbError("دستگاه نامعتبر است.", "BAD_REQUEST");
  return s;
}

function remotePath(v: unknown) {
  const p = String(v ?? "");
  if (!p.startsWith("/") || p.includes("\0")) throw new adb.AdbError("مسیر نامعتبر است.", "BAD_REQUEST");
  return path.posix.normalize(p);
}

function hostPort(body: Record<string, unknown>) {
  const host = String(body.host ?? "").trim();
  const port = Number(body.port);
  if (!HOST_RE.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new adb.AdbError("آدرس IP یا پورت نامعتبر است.", "BAD_REQUEST");
  }
  return { host, port };
}

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).then((data) => {
      if (!res.headersSent && data !== undefined) res.json(data);
    }, next);

/* ------------------------------- connection ------------------------------- */

app.get(
  "/api/devices",
  h(async () => ({ devices: await adb.listDevices() })),
);

app.get(
  "/api/discover",
  h(async () => ({ services: await adb.mdnsServices() })),
);

app.post(
  "/api/pair",
  h(async (req) => {
    const { host, port } = hostPort(req.body);
    const code = String(req.body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) throw new adb.AdbError("کد جفت‌سازی باید ۶ رقم باشد.", "BAD_REQUEST");
    await adb.pair(host, port, code);
    return { ok: true };
  }),
);

app.post(
  "/api/connect",
  h(async (req) => {
    const { host, port } = hostPort(req.body);
    const serial = await adb.connect(host, port);
    return { serial };
  }),
);

app.post(
  "/api/disconnect",
  h(async (req) => {
    await adb.disconnect(serialOf(req));
    return { ok: true };
  }),
);

app.get(
  "/api/info",
  h(async (req) => {
    const serial = serialOf(req);
    void adb.fixPendingMedia(serial);
    return adb.deviceInfo(serial);
  }),
);

/* ---------------------------------- files --------------------------------- */

app.get(
  "/api/ls",
  h(async (req) => ({ entries: await adb.listDir(serialOf(req), remotePath(req.query.path)) })),
);

app.post(
  "/api/mkdir",
  h(async (req) => {
    await adb.mkdir(serialOf(req), remotePath(req.body.path));
    return { ok: true };
  }),
);

app.post(
  "/api/delete",
  h(async (req) => {
    const paths = (req.body.paths as unknown[]).map(remotePath);
    if (!paths.length || paths.some((p) => p === "/" || p.split("/").length < 3)) {
      throw new adb.AdbError("حذف پوشه‌های ریشه مجاز نیست.", "BAD_REQUEST");
    }
    await adb.remove(serialOf(req), paths);
    return { ok: true };
  }),
);

app.post(
  "/api/move",
  h(async (req) => {
    const serial = serialOf(req);
    const to = remotePath(req.body.to);
    await adb.move(serial, remotePath(req.body.from), to);
    await adb.scanMedia(serial, [to]);
    return { ok: true };
  }),
);

app.post(
  "/api/copy",
  h(async (req) => {
    const serial = serialOf(req);
    const to = remotePath(req.body.to);
    await adb.copy(serial, remotePath(req.body.from), to);
    await adb.scanMedia(serial, [to]);
    return { ok: true };
  }),
);

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm", txt: "text/plain; charset=utf-8", log: "text/plain; charset=utf-8",
  json: "application/json", xml: "text/xml", pdf: "application/pdf",
};

app.get(
  "/api/download",
  h(async (req, res) => {
    const serial = serialOf(req);
    const p = remotePath(req.query.path);
    const inline = req.query.inline === "1";
    const { isDir, size } = await adb.statPath(serial, p);
    const name = path.posix.basename(p) || "root";
    const fileName = isDir ? `${name}.tar` : name;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";

    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader("Content-Type", isDir ? "application/x-tar" : (MIME[ext] ?? "application/octet-stream"));
    if (!isDir) res.setHeader("Content-Length", String(size));

    const cmd = isDir
      ? `tar -c -C ${adb.shq(path.posix.dirname(p))} ${adb.shq(name)} 2>/dev/null`
      : `cat ${adb.shq(p)}`;
    const child = adb.spawnAdb(["-s", serial, "exec-out", cmd]);
    child.stdout!.pipe(res);
    res.on("close", () => child.kill());
    await new Promise((r) => child.on("close", r));
    return undefined;
  }),
);

app.put(
  "/api/upload",
  h(async (req, res) => {
    const serial = serialOf(req);
    const dest = remotePath(req.query.path);
    const part = `${dest}.part`;
    const child = adb.spawnAdb(["-s", serial, "exec-in", `cat > ${adb.shq(part)}`]);
    let stderr = "";
    child.stderr!.on("data", (d) => (stderr += d));
    child.stdout!.on("data", (d) => (stderr += d));

    let aborted = false;
    req.on("aborted", () => {
      aborted = true;
      child.kill();
    });
    req.pipe(child.stdin!);

    const code = await new Promise<number | null>((r) => child.on("close", r));
    if (aborted || code !== 0 || /denied|No such|error/i.test(stderr)) {
      await adb.shell(serial, `rm -f ${adb.shq(part)}`).catch(() => {});
      if (aborted) return undefined;
      if (/denied|Read-only/i.test(stderr)) throw new adb.AdbError("اجازهٔ نوشتن در این پوشه وجود ندارد.", "DENIED");
      throw new adb.AdbError(stderr.trim() || "ارسال فایل انجام نشد.");
    }
    await adb.shell(serial, `mv -f ${adb.shq(part)} ${adb.shq(dest)}`);
    // The rename leaves the MediaStore row pending (hidden from Gallery) until scanned.
    await adb.scanMedia(serial, [dest]);
    res.json({ ok: true });
    return undefined;
  }),
);

/* --------------------------------- errors --------------------------------- */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const code = err instanceof adb.AdbError ? err.code : "INTERNAL";
  if (/device .* not found|device offline|no devices/i.test(err.message)) {
    return res.status(409).json({ error: "ارتباط با ساعت قطع شده است.", code: "DEVICE_LOST" });
  }
  const status = code === "BAD_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : code === "DENIED" ? 403 : 500;
  if (!res.headersSent) res.status(status).json({ error: err.message, code });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// Bound to loopback only: this API has full access to the watch's filesystem.
const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Watch Drive API → http://127.0.0.1:${PORT}`);
});

// Live view. WebSockets skip CORS, so only accept pages served from this machine.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const origin = req.headers.origin ? new URL(req.headers.origin).hostname : "localhost";
  const serial = url.searchParams.get("serial") ?? "";
  if (url.pathname !== "/api/mirror" || !["localhost", "127.0.0.1"].includes(origin) || !SERIAL_RE.test(serial)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => void runMirror(serial, ws));
});

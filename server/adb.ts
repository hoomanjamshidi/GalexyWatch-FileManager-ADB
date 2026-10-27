import { execFile, spawn, type ChildProcess } from "node:child_process";

const ADB = process.env.ADB_PATH || "adb";

export class AdbError extends Error {
  constructor(
    message: string,
    public code: string = "ADB_ERROR",
  ) {
    super(message);
  }
}

/** Run adb and resolve with combined stdout/stderr. */
export function adb(args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new AdbError("adb روی این سیستم پیدا نشد. Android platform-tools را نصب کنید.", "ADB_MISSING"));
        }
        if (err.killed) return reject(new AdbError("پاسخی از ساعت دریافت نشد (timeout).", "TIMEOUT"));
        return reject(new AdbError(out || err.message));
      }
      resolve(out);
    });
  });
}

/** Single-quote a string for the device's /system/bin/sh. */
export function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function shell(serial: string, command: string, timeoutMs?: number) {
  return adb(["-s", serial, "shell", command], timeoutMs);
}

export function spawnAdb(args: string[]): ChildProcess {
  return spawn(ADB, args, { stdio: ["pipe", "pipe", "pipe"] });
}

/* -------------------------------------------------------------------------- */

export interface Device {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
  wireless: boolean;
}

export async function listDevices(): Promise<Device[]> {
  const out = await adb(["devices", "-l"]);
  return out
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*"))
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const props = Object.fromEntries(
        rest.filter((p) => p.includes(":")).map((p) => p.split(":") as [string, string]),
      );
      return {
        serial,
        state,
        model: props.model?.replace(/_/g, " "),
        product: props.product,
        device: props.device,
        wireless: serial.includes(":") || serial.includes("._adb-tls-connect"),
      };
    });
}

export interface MdnsService {
  name: string;
  type: "pairing" | "connect";
  host: string;
  port: number;
}

export async function mdnsServices(): Promise<MdnsService[]> {
  const out = await adb(["mdns", "services"], 5_000).catch(() => "");
  const services: MdnsService[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+_adb-tls-(pairing|connect)\._tcp\.?\s+([\d.]+):(\d+)/);
    if (m) services.push({ name: m[1], type: m[2] as MdnsService["type"], host: m[3], port: Number(m[4]) });
  }
  return services;
}

export async function pair(host: string, port: number, code: string) {
  const out = await adb(["pair", `${host}:${port}`, code], 30_000).catch((e: AdbError) => e.message);
  if (/Successfully paired/i.test(out)) return out;
  if (/wrong password|incorrect/i.test(out)) {
    throw new AdbError("کد جفت‌سازی اشتباه است یا منقضی شده. یک کد تازه از ساعت بگیرید.", "BAD_CODE");
  }
  if (/connection refused|unable to connect|failed to connect|No route|timed out|protocol fault|Unable to start/i.test(out)) {
    throw new AdbError("به پورت جفت‌سازی دسترسی نیست. صفحهٔ «Pair new device» روی ساعت باید باز بماند.", "UNREACHABLE");
  }
  throw new AdbError(out || "جفت‌سازی انجام نشد.", "PAIR_FAILED");
}

export async function connect(host: string, port: number) {
  const target = `${host}:${port}`;
  const out = await adb(["connect", target], 20_000).catch((e: AdbError) => e.message);
  if (/connected to|already connected/i.test(out)) {
    // adb sometimes reports "connected" for an unauthorized device; confirm state.
    await new Promise((r) => setTimeout(r, 400));
    const dev = (await listDevices()).find((d) => d.serial === target);
    if (dev?.state === "unauthorized") {
      await adb(["disconnect", target]).catch(() => {});
      throw new AdbError("ساعت این کامپیوتر را نمی‌شناسد. دوباره جفت‌سازی کنید.", "NOT_PAIRED");
    }
    if (dev?.state === "offline") {
      await adb(["disconnect", target]).catch(() => {});
      throw new AdbError("ساعت آفلاین است. Wireless debugging را خاموش و روشن کنید.", "OFFLINE");
    }
    return target;
  }
  if (/failed to authenticate|authentication|unauthorized/i.test(out)) {
    throw new AdbError("ساعت این کامپیوتر را نمی‌شناسد. دوباره جفت‌سازی کنید.", "NOT_PAIRED");
  }
  if (/refused|unable to connect|failed to connect|No route|timed out|cannot connect/i.test(out)) {
    throw new AdbError("اتصال برقرار نشد. IP و پورت صفحهٔ Wireless debugging را بررسی کنید.", "UNREACHABLE");
  }
  throw new AdbError(out || "اتصال برقرار نشد.", "CONNECT_FAILED");
}

export async function disconnect(serial: string) {
  return adb(["disconnect", serial]);
}

/* -------------------------------------------------------------------------- */

export interface DeviceInfo {
  model: string;
  manufacturer: string;
  android: string;
  battery?: number;
  charging?: boolean;
  storage?: { total: number; used: number; free: number };
}

export async function deviceInfo(serial: string): Promise<DeviceInfo> {
  const sep = "__SEP__";
  const out = await shell(
    serial,
    [
      "getprop ro.product.model",
      "getprop ro.product.manufacturer",
      "getprop ro.build.version.release",
      "dumpsys battery 2>/dev/null | grep -E 'level|powered'",
      "df -k /sdcard 2>/dev/null | tail -1",
    ].join(`; echo ${sep}; `),
  );
  const [model, manufacturer, android, battery, df] = out.split(sep).map((s) => s.trim());
  const info: DeviceInfo = { model, manufacturer, android };
  const level = battery?.match(/level:\s*(\d+)/);
  if (level) info.battery = Number(level[1]);
  info.charging = /powered:\s*true/.test(battery ?? "");
  const cols = df?.split(/\s+/);
  if (cols && cols.length >= 4 && /^\d+$/.test(cols[1])) {
    info.storage = { total: Number(cols[1]) * 1024, used: Number(cols[2]) * 1024, free: Number(cols[3]) * 1024 };
  }
  return info;
}

export interface Entry {
  name: string;
  path: string;
  type: "dir" | "file" | "link" | "other";
  size: number;
  mtime: number;
  mode: string;
}

export async function listDir(serial: string, dir: string): Promise<Entry[]> {
  const base = dir.endsWith("/") ? dir : `${dir}/`;
  // -L follows symlinks so /sdcard-style links show up as folders.
  const cmd = `cd ${shq(dir)} || exit 3; for f in * .[!.]* ..?*; do [ -e "$f" ] || [ -L "$f" ] || continue; stat -L -c '%F|%s|%Y|%A|%n' -- "$f" 2>/dev/null || echo "broken|0|0|?|$f"; done`;
  let out: string;
  try {
    out = await shell(serial, cmd, 30_000);
  } catch (e) {
    const msg = (e as Error).message;
    if (/Permission denied/i.test(msg)) throw new AdbError("اجازهٔ دسترسی به این پوشه وجود ندارد.", "DENIED");
    if (/No such file|can't cd/i.test(msg)) throw new AdbError("این پوشه وجود ندارد.", "NOT_FOUND");
    throw e;
  }
  if (/can't cd|No such file/i.test(out) && !out.includes("|")) throw new AdbError("این پوشه وجود ندارد.", "NOT_FOUND");
  if (/Permission denied/i.test(out) && !out.includes("|")) throw new AdbError("اجازهٔ دسترسی به این پوشه وجود ندارد.", "DENIED");
  const entries: Entry[] = [];
  for (const line of out.split("\n")) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const [kind, size, mtime, mode] = parts;
    const name = parts.slice(4).join("|");
    if (!name || name === "." || name === "..") continue;
    entries.push({
      name,
      path: base + name,
      type: kind.includes("directory") ? "dir" : kind.includes("regular") ? "file" : kind === "broken" ? "link" : "other",
      size: Number(size) || 0,
      mtime: Number(mtime) * 1000 || 0,
      mode,
    });
  }
  return entries;
}

export async function statPath(serial: string, p: string) {
  const out = await shell(serial, `stat -L -c '%F|%s' -- ${shq(p)}`);
  const [kind, size] = out.split("|");
  if (!size) throw new AdbError("فایل پیدا نشد.", "NOT_FOUND");
  return { isDir: kind.includes("directory"), size: Number(size) };
}

async function run(serial: string, cmd: string) {
  const out = await shell(serial, `${cmd} 2>&1; echo "__EXIT:$?"`, 120_000);
  const m = out.match(/__EXIT:(\d+)\s*$/);
  const text = out.replace(/__EXIT:\d+\s*$/, "").trim();
  if (!m || m[1] !== "0") {
    if (/Permission denied|Read-only/i.test(text)) throw new AdbError("اجازهٔ این کار روی ساعت وجود ندارد.", "DENIED");
    if (/exists/i.test(text)) throw new AdbError("چیزی با این نام از قبل وجود دارد.", "EXISTS");
    throw new AdbError(text || "عملیات انجام نشد.");
  }
  return text;
}

/* --------------------------------- media ---------------------------------- */

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif|mp3|m4a|aac|ogg|oga|opus|wav|flac|amr|mp4|webm|mkv|3gp|mov)$/i;

/** Map an adb-visible path to MediaProvider's canonical one; null when outside shared storage. */
function mediaPath(p: string) {
  if (p === "/sdcard" || p.startsWith("/sdcard/")) return `/storage/emulated/0${p.slice("/sdcard".length)}`;
  if (p.startsWith("/storage/emulated/0/") || p.startsWith("/storage/self/primary/")) {
    return p.replace(/^\/storage\/self\/primary/, "/storage/emulated/0");
  }
  return null;
}

/**
 * Ask MediaProvider to (re)scan files so they show up in Gallery / music apps.
 * Files written by `adb` and then renamed stay `is_pending=1` (hidden) until scanned.
 * Folders are expanded to the media files inside them. Best effort: failures are ignored.
 */
export async function scanMedia(serial: string, paths: string[]) {
  const roots = paths.map(mediaPath).filter((p): p is string => !!p);
  if (!roots.length) return;
  const scan = `content call --uri content://media/external/file --method scan_file --arg "$f" >/dev/null 2>&1 || am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://$f" >/dev/null 2>&1`;
  const cmd = `find ${roots.map(shq).join(" ")} -type f 2>/dev/null | while IFS= read -r f; do ${scan}; done`;
  const files = roots.filter((r) => MEDIA_EXT.test(r));
  // Plain media files skip `find`; folders (and anything else) go through it.
  const direct = files.length === roots.length;
  await shell(
    serial,
    direct ? `for f in ${files.map(shq).join(" ")}; do ${scan}; done` : cmd,
    Math.max(30_000, roots.length * 5_000),
  ).catch(() => {});
}

/** Re-scan media that earlier adb uploads left hidden (pending) in MediaStore. */
export async function fixPendingMedia(serial: string) {
  const out = await shell(
    serial,
    `content query --uri content://media/external/file --projection _data --where "is_pending=1 AND owner_package_name='com.android.shell'"`,
  ).catch(() => "");
  const stuck = [...out.matchAll(/_data=(.+?)(?:, \w+=|$)/gm)].map((m) => m[1].trim()).filter((p) => MEDIA_EXT.test(p));
  if (stuck.length) await scanMedia(serial, stuck.map((p) => p.replace(/^\/storage\/emulated\/0/, "/sdcard")));
  return stuck.length;
}

export const mkdir = (serial: string, p: string) => run(serial, `mkdir -p -- ${shq(p)}`);
export const remove = (serial: string, paths: string[]) => run(serial, `rm -rf -- ${paths.map(shq).join(" ")}`);
export const move = (serial: string, from: string, to: string) =>
  run(serial, `[ -e ${shq(to)} ] && echo "exists" && exit 1; mv -- ${shq(from)} ${shq(to)}`);
export const copy = (serial: string, from: string, to: string) =>
  run(serial, `[ -e ${shq(to)} ] && echo "exists" && exit 1; cp -r -- ${shq(from)} ${shq(to)}`);

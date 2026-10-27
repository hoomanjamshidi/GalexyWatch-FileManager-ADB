const numFmt = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });

export const faNum = (n: number) => numFmt.format(n);

export function formatBytes(bytes: number) {
  if (!bytes) return "۰ بایت";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${numFmt.format(i === 0 ? v : Math.round(v * 10) / 10)} ${units[i]}`;
}

const dayFmt = new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" });
const yearFmt = new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" });

export function formatDate(ms: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : yearFmt.format(d);
}

export type FileKind = "folder" | "image" | "audio" | "video" | "text" | "archive" | "apk" | "pdf" | "other";

const EXT: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(" ").forEach((e) => (EXT[e] = kind));
add("image", "jpg jpeg png gif webp bmp heic svg");
add("audio", "mp3 m4a aac ogg wav flac opus amr");
add("video", "mp4 webm mkv 3gp mov");
add("text", "txt log json xml csv md ini conf prop cfg yaml yml sh");
add("archive", "zip tar gz 7z rar tgz");
add("apk", "apk apks xapk");
add("pdf", "pdf");

export function kindOf(name: string, isDir: boolean): FileKind {
  if (isDir) return "folder";
  return EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "other";
}

export const KIND_LABEL: Record<FileKind, string> = {
  folder: "پوشه",
  image: "تصویر",
  audio: "صوت",
  video: "ویدیو",
  text: "متن",
  archive: "فشرده",
  apk: "برنامه",
  pdf: "PDF",
  other: "فایل",
};

export const joinPath = (dir: string, name: string) => (dir === "/" ? `/${name}` : `${dir}/${name}`);
export const parentOf = (p: string) => p.replace(/\/[^/]+\/?$/, "") || "/";
export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? "/";

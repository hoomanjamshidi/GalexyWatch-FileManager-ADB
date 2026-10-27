export interface Device {
  serial: string;
  state: string;
  model?: string;
  wireless: boolean;
}

export interface MdnsService {
  name: string;
  type: "pairing" | "connect";
  host: string;
  port: number;
}

export interface DeviceInfo {
  model: string;
  manufacturer: string;
  android: string;
  battery?: number;
  charging?: boolean;
  storage?: { total: number; used: number; free: number };
}

export interface Entry {
  name: string;
  path: string;
  type: "dir" | "file" | "link" | "other";
  size: number;
  mtime: number;
  mode: string;
}

export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

type Listener = () => void;
const deviceLostListeners = new Set<Listener>();
export function onDeviceLost(fn: Listener) {
  deviceLostListeners.add(fn);
  return () => void deviceLostListeners.delete(fn);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("سرور محلی در دسترس نیست. آیا npm run dev در حال اجراست؟", "SERVER_DOWN");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(data.error ?? "خطای ناشناخته", data.code ?? "UNKNOWN");
    if (err.code === "DEVICE_LOST") deviceLostListeners.forEach((fn) => fn());
    throw err;
  }
  return data as T;
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const api = {
  devices: () => request<{ devices: Device[] }>("/api/devices").then((r) => r.devices),
  discover: () => request<{ services: MdnsService[] }>("/api/discover").then((r) => r.services),
  pair: (host: string, port: number, code: string) => post("/api/pair", { host, port, code }),
  connect: (host: string, port: number) => post<{ serial: string }>("/api/connect", { host, port }).then((r) => r.serial),
  disconnect: (serial: string) => post("/api/disconnect", { serial }),
  info: (serial: string) => request<DeviceInfo>(`/api/info?${q({ serial })}`),
  ls: (serial: string, path: string) =>
    request<{ entries: Entry[] }>(`/api/ls?${q({ serial, path })}`).then((r) => r.entries),
  mkdir: (serial: string, path: string) => post("/api/mkdir", { serial, path }),
  remove: (serial: string, paths: string[]) => post("/api/delete", { serial, paths }),
  move: (serial: string, from: string, to: string) => post("/api/move", { serial, from, to }),
  copy: (serial: string, from: string, to: string) => post("/api/copy", { serial, from, to }),
  fileUrl: (serial: string, path: string, inline = false) =>
    `/api/download?${q({ serial, path, ...(inline ? { inline: "1" } : {}) })}`,

  upload(serial: string, path: string, file: Blob, onProgress: (p: number) => void, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/upload?${q({ serial, path })}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status < 300) return resolve();
        let msg = "ارسال فایل انجام نشد.";
        let code = "UNKNOWN";
        try {
          ({ error: msg, code } = JSON.parse(xhr.responseText));
        } catch {
          /* keep defaults */
        }
        if (code === "DEVICE_LOST") deviceLostListeners.forEach((fn) => fn());
        reject(new ApiError(msg, code));
      };
      xhr.onerror = () => reject(new ApiError("ارتباط قطع شد.", "NETWORK"));
      xhr.onabort = () => reject(new ApiError("لغو شد", "ABORTED"));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(file);
    });
  },
};

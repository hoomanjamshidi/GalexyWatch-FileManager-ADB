import { useCallback, useEffect, useRef, useState } from "react";

export type MirrorState =
  | { status: "connecting" }
  | { status: "live"; width: number; height: number }
  | { status: "error"; message: string };

/** H.264 codec string (avc1.PPCCLL) from the SPS inside an Annex-B config packet. */
function avcCodec(config: Uint8Array) {
  for (let i = 0; i + 4 < config.length; i++) {
    const start = config[i] === 0 && config[i + 1] === 0 && (config[i + 2] === 1 || (config[i + 2] === 0 && config[i + 3] === 1));
    if (!start) continue;
    const nal = i + (config[i + 2] === 1 ? 3 : 4);
    if ((config[nal] & 0x1f) === 7) {
      const hex = (b: number) => b.toString(16).padStart(2, "0");
      return `avc1.${hex(config[nal + 1])}${hex(config[nal + 2])}${hex(config[nal + 3])}`;
    }
  }
  return "avc1.42e01f";
}

/**
 * Streams the watch screen into `canvas` and returns an input sender.
 * Video arrives as `[flags][H.264 Annex-B]` (flags: 1 = config, 2 = key frame).
 */
export function useMirror(serial: string, canvas: React.RefObject<HTMLCanvasElement | null>, attempt: number) {
  const [state, setState] = useState<MirrorState>({ status: "connecting" });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof VideoDecoder === "undefined") {
      setState({ status: "error", message: "این مرورگر از WebCodecs پشتیبانی نمی‌کند. از Chrome یا Safari جدید استفاده کنید." });
      return;
    }
    setState({ status: "connecting" });
    let ws: WebSocket | null = null;

    let decoder: VideoDecoder | null = null;
    let pendingConfig: Uint8Array | null = null;
    let needKey = true;
    let ts = 0;
    let failed = false;

    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      setState({ status: "error", message });
    };

    const ensureDecoder = (codec: string) => {
      decoder?.close();
      decoder = new VideoDecoder({
        output: (frame) => {
          const c = canvas.current;
          if (c) {
            if (c.width !== frame.displayWidth) c.width = frame.displayWidth;
            if (c.height !== frame.displayHeight) c.height = frame.displayHeight;
            c.getContext("2d")?.drawImage(frame, 0, 0);
          }
          frame.close();
        },
        error: (e) => {
          // Recover on the next key frame instead of giving up.
          console.warn("decoder error", e);
          needKey = true;
          decoder = null;
        },
      });
      decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
      needKey = true;
    };

    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        if (msg.type === "size") setState({ status: "live", width: msg.width, height: msg.height });
        else if (msg.type === "error") fail(msg.message);
        return;
      }
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      const flags = buf[0];
      const data = buf.subarray(1);
      if (flags & 1) {
        pendingConfig = data.slice();
        ensureDecoder(avcCodec(pendingConfig));
        return;
      }
      const key = (flags & 2) !== 0;
      if (!decoder) {
        if (!pendingConfig || !key) return;
        ensureDecoder(avcCodec(pendingConfig));
      }
      if (needKey && !key) return;
      let payload = data;
      if (key && pendingConfig) {
        // The decoder needs SPS/PPS in front of the first key frame (Annex-B mode).
        payload = new Uint8Array(pendingConfig.length + data.length);
        payload.set(pendingConfig);
        payload.set(data, pendingConfig.length);
      }
      try {
        decoder!.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: (ts += 33_333), data: payload }));
        needKey = false;
      } catch {
        needKey = true;
      }
    };
    // Deferred so a mount/unmount in the same tick (React StrictMode) never opens a socket.
    const timer = setTimeout(() => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/mirror?serial=${encodeURIComponent(serial)}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = onMessage;
      ws.onerror = () => fail("اتصال به سرور محلی برقرار نشد.");
      ws.onclose = () => fail("نمایش زنده قطع شد.");
    }, 120);

    return () => {
      failed = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
      try {
        decoder?.close();
      } catch {
        /* already closed */
      }
    };
  }, [serial, canvas, attempt]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { state, send };
}

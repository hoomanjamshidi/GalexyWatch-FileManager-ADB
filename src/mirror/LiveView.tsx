import { motion, useDragControls } from "motion/react";
import { Camera, GripHorizontal, Home, Maximize2, Minimize2, RotateCcw, Sun, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { TextShimmer } from "@/components/loading-states";
import { Button, EASE, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useMirror } from "./useMirror";

const KEY_HOME = 3;
const KEY_WAKEUP = 224;

export function LiveView({ serial, onClose }: { serial: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [large, setLarge] = useState(false);
  const { state, send } = useMirror(serial, canvas, attempt);
  const drag = useDragControls();
  const down = useRef(false);
  const size = large ? 420 : 300;

  const toDevice = (clientX: number, clientY: number) => {
    const c = canvas.current;
    if (!c || state.status !== "live") return null;
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(state.width - 1, ((clientX - r.left) / r.width) * state.width)),
      y: Math.max(0, Math.min(state.height - 1, ((clientY - r.top) / r.height) * state.height)),
    };
  };

  const pointer = (a: 0 | 1 | 2) => (e: PointerEvent<HTMLCanvasElement>) => {
    if (a === 0) {
      e.currentTarget.setPointerCapture(e.pointerId);
      down.current = true;
    } else if (!down.current) return;
    if (a === 1) down.current = false;
    const p = toDevice(e.clientX, e.clientY);
    if (p) send({ t: "touch", a, ...p });
  };

  // Wheel → scroll (the closest thing to turning the bezel). Needs a non-passive listener.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (s.status !== "live") return;
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * s.width;
      const y = ((e.clientY - r.top) / r.height) * s.height;
      const k = e.deltaMode === 1 ? 1 : 1 / 100;
      send({ t: "scroll", x, y, h: -e.deltaX * k, v: -e.deltaY * k });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [send]);

  const screenshot = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `watch-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };

  const live = state.status === "live";

  return createPortal(
    <motion.div
      dir="rtl"
      drag
      dragListener={false}
      dragControls={drag}
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25, ease: EASE }}
      className="fixed left-6 top-6 z-40 select-none rounded-[32px] border border-line bg-surface/95 shadow-soft backdrop-blur"
    >
      {/* header doubles as the drag handle */}
      <div
        onPointerDown={(e) => {
          // Let the header's buttons receive their clicks.
          if (!(e.target as HTMLElement).closest("button")) drag.start(e);
        }}
        className="flex h-12 cursor-grab items-center gap-2 pe-2 ps-5 active:cursor-grabbing"
      >
        <span className={cn("size-2 rounded-full", live ? "bg-success" : state.status === "error" ? "bg-danger" : "animate-pulse bg-faint")} />
        <span className="flex-1 text-sm font-medium">نمایش زنده</span>
        <GripHorizontal className="size-4 text-faint" />
        <IconButton label={large ? "کوچک‌تر" : "بزرگ‌تر"} onClick={() => setLarge((l) => !l)} className="size-8">
          {large ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </IconButton>
        <IconButton label="بستن" onClick={onClose} className="size-8">
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="px-6 pb-4 pt-1">
        {/* watch body */}
        <motion.div
          animate={{ width: size + 28, height: size + 28 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="relative mx-auto rounded-full bg-[linear-gradient(145deg,#4a4d55,#16171a_55%,#2c2e33)] p-[14px] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55),inset_0_1px_1px_rgb(255_255_255/0.15)]"
        >
          <div className="relative size-full overflow-hidden rounded-full bg-black ring-1 ring-black">
            <canvas
              ref={canvas}
              width={450}
              height={450}
              onPointerDown={pointer(0)}
              onPointerMove={pointer(2)}
              onPointerUp={pointer(1)}
              onPointerCancel={pointer(1)}
              onContextMenu={(e) => e.preventDefault()}
              className={cn("size-full touch-none transition-opacity duration-300", live ? "cursor-pointer opacity-100" : "opacity-0")}
            />
            {!live && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-white/80">
                {state.status === "connecting" ? (
                  <TextShimmer className="[--foreground:#fff] [--muted-foreground:#777]">در حال راه‌اندازی تصویر…</TextShimmer>
                ) : (
                  <div>
                    <p className="mb-4 leading-6">{state.message}</p>
                    <Button variant="tonal" className="h-9" icon={<RotateCcw className="size-4" />} onClick={() => setAttempt((n) => n + 1)}>
                      تلاش دوباره
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* hardware-ish controls */}
        <div className="mt-4 flex items-center justify-center gap-1">
          <IconButton label="بازگشت" disabled={!live} onClick={() => send({ t: "back" })}>
            <Undo2 className="size-5" />
          </IconButton>
          <IconButton label="خانه" disabled={!live} onClick={() => send({ t: "key", code: KEY_HOME })}>
            <Home className="size-5" />
          </IconButton>
          <IconButton label="روشن کردن صفحه" disabled={!live} onClick={() => send({ t: "key", code: KEY_WAKEUP })}>
            <Sun className="size-5" />
          </IconButton>
          <IconButton label="عکس از صفحه" disabled={!live} onClick={screenshot}>
            <Camera className="size-5" />
          </IconButton>
        </div>
        <p className="mt-1 text-center text-[11px] leading-5 text-faint">کلیک = لمس · کشیدن = سوایپ · چرخ موس = اسکرول</p>
      </div>
    </motion.div>,
    document.body,
  );
}

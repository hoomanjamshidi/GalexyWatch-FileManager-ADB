import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TextShimmer } from "@/components/loading-states";
import { Button, EASE } from "@/components/ui";
import { api, type Entry } from "@/lib/api";
import { faNum, formatBytes, kindOf } from "@/lib/format";
import { FileIcon } from "./FileIcon";

/* --------------------------------- preview -------------------------------- */

export function Preview({
  serial,
  entries,
  index,
  onIndex,
  onClose,
}: {
  serial: string;
  entries: Entry[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const entry = index === null ? null : entries[index];

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // RTL: left arrow moves forward.
      if (e.key === "ArrowLeft" && index < entries.length - 1) onIndex(index + 1);
      if (e.key === "ArrowRight" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, entries.length, onIndex, onClose]);

  return createPortal(
    <AnimatePresence>
      {entry && index !== null && (
        <motion.div
          dir="rtl"
          className="fixed inset-0 z-50 flex flex-col bg-[#0e0f12]/92 text-white backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex h-16 shrink-0 items-center gap-3 px-4">
            <button onClick={onClose} className="grid size-10 place-items-center rounded-full hover:bg-white/10" title="بستن">
              <X className="size-5" />
            </button>
            <FileIcon kind={kindOf(entry.name, false)} />
            <span dir="auto" className="min-w-0 flex-1 truncate text-[15px]">
              {entry.name}
            </span>
            <a
              href={api.fileUrl(serial, entry.path)}
              className="grid size-10 place-items-center rounded-full hover:bg-white/10"
              title="دانلود"
            >
              <Download className="size-5" />
            </a>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-10" onClick={(e) => e.target === e.currentTarget && onClose()}>
            {index > 0 && (
              <button
                onClick={() => onIndex(index - 1)}
                className="absolute right-4 grid size-12 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <ChevronRight className="size-6" />
              </button>
            )}
            <motion.div
              key={entry.path}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="flex max-h-full max-w-full items-center justify-center"
            >
              <PreviewBody serial={serial} entry={entry} />
            </motion.div>
            {index < entries.length - 1 && (
              <button
                onClick={() => onIndex(index + 1)}
                className="absolute left-4 grid size-12 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <ChevronLeft className="size-6" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PreviewBody({ serial, entry }: { serial: string; entry: Entry }) {
  const url = api.fileUrl(serial, entry.path, true);
  const kind = kindOf(entry.name, false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text" || entry.size > 2_000_000) return;
    setText(null);
    let alive = true;
    fetch(url)
      .then((r) => r.text())
      .then((t) => alive && setText(t))
      .catch(() => alive && setText("خواندن فایل ممکن نشد."));
    return () => {
      alive = false;
    };
  }, [url, kind, entry.size]);

  if (kind === "image") return <img src={url} alt={entry.name} className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl" />;
  if (kind === "video") return <video src={url} controls autoPlay className="max-h-[80vh] max-w-full rounded-lg" />;
  if (kind === "audio")
    return (
      <div className="w-[min(420px,80vw)] rounded-3xl bg-white/5 p-8 text-center">
        <FileIcon kind="audio" className="mx-auto mb-4 size-14" />
        <div dir="auto" className="mb-5 truncate">{entry.name}</div>
        <audio src={url} controls autoPlay className="w-full" />
      </div>
    );
  if (kind === "pdf") return <iframe src={url} title={entry.name} className="h-[80vh] w-[min(900px,85vw)] rounded-lg bg-white" />;
  if (kind === "text" && entry.size <= 2_000_000)
    return (
      <pre dir="ltr" className="scroll-thin max-h-[80vh] w-[min(900px,85vw)] overflow-auto rounded-2xl bg-[#1b1d22] p-6 text-left font-mono text-[13px] leading-6 text-white/90">
        {text ?? <TextShimmer>Loading…</TextShimmer>}
      </pre>
    );
  return (
    <div className="rounded-3xl bg-white/5 px-12 py-10 text-center">
      <FileIcon kind={kind} className="mx-auto mb-4 size-14" />
      <div className="mb-1">پیش‌نمایش برای این فایل در دسترس نیست</div>
      <div className="mb-6 text-sm text-white/60">{formatBytes(entry.size)}</div>
      <a href={api.fileUrl(serial, entry.path)}>
        <Button variant="tonal" icon={<Download className="size-4" />}>
          دانلود
        </Button>
      </a>
    </div>
  );
}

/* ------------------------------- undo toast ------------------------------- */

export interface PendingDelete {
  id: number;
  label: string;
  seconds: number;
}

/** Snackbar with a draining ring; deletion only hits the watch once the timer runs out. */
export function UndoToast({ pending, onUndo }: { pending: PendingDelete | null; onUndo: () => void }) {
  return createPortal(
    <AnimatePresence>
      {pending && (
        <div key={pending.id} className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center">
        <motion.div
          dir="rtl"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease: EASE }}
          className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-[#2b2d31] py-2 pe-2 ps-4 text-sm text-white shadow-soft dark:bg-[#e6e8ec] dark:text-[#1b1c1f]"
        >
          <Countdown seconds={pending.seconds} />
          <span className="max-w-[50vw] truncate">{pending.label}</span>
          <button onClick={onUndo} className="h-9 rounded-full px-4 font-medium text-[#a8c7fa] hover:bg-white/10 dark:text-[#0b57d0] dark:hover:bg-black/5">
            بازگردانی
          </button>
        </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="relative grid size-7 place-items-center">
      <svg viewBox="0 0 28 28" className="absolute inset-0 -rotate-90">
        <circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
        <motion.circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke="#f28b82"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1}
          initial={{ pathLength: 1 }}
          animate={{ pathLength: 0 }}
          transition={{ duration: seconds, ease: "linear" }}
        />
      </svg>
      <span className="text-xs font-medium tabular-nums">{faNum(left)}</span>
    </span>
  );
}

/* ------------------------------- drop overlay ------------------------------ */

export function DropOverlay({ show, target }: { show: boolean; target: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] border-2 border-primary bg-primary/5"
        >
          <div className="absolute inset-x-0 bottom-8 flex justify-center">
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="rounded-2xl bg-primary px-6 py-3 text-sm text-primary-fg shadow-soft"
          >
            برای آپلود در «<span dir="auto">{target}</span>» رها کنید
          </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { StatusMark, type StatusMarkStatus } from "@/components/status-mark";
import { EASE, IconButton } from "@/components/ui";
import { api } from "@/lib/api";
import { faNum, formatBytes, kindOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FileIcon } from "./FileIcon";

export interface Transfer {
  id: number;
  name: string;
  dest: string;
  size: number;
  progress: number;
  status: StatusMarkStatus;
  error?: string;
}

interface Job {
  id: number;
  file: File;
  dest: string;
  ctrl: AbortController;
}

let nextId = 1;

/** Sequential upload queue — the watch's Wi‑Fi link is the bottleneck, parallelism only hurts. */
export function useTransfers(serial: string, onSettled: (dirs: string[]) => void) {
  const [items, setItems] = useState<Transfer[]>([]);
  const queue = useRef<Job[]>([]);
  const running = useRef(false);
  const touched = useRef(new Set<string>());
  const ctrlMap = useRef(new Map<number, AbortController>());

  const patch = (id: number, p: Partial<Transfer>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const job = queue.current.shift()!;
      if (job.ctrl.signal.aborted) continue;
      patch(job.id, { status: "running", progress: 0 });
      try {
        await api.upload(serial, job.dest, job.file, (p) => patch(job.id, { progress: p }), job.ctrl.signal);
        patch(job.id, { status: "done", progress: 1 });
      } catch (e) {
        patch(job.id, job.ctrl.signal.aborted ? { status: "cancelled" } : { status: "failed", error: (e as Error).message });
      }
      touched.current.add(job.dest.replace(/\/[^/]+$/, "") || "/");
    }
    running.current = false;
    onSettled([...touched.current]);
    touched.current.clear();
  }, [serial, onSettled]);

  const enqueue = useCallback(
    (files: { file: File; dest: string }[]) => {
      const jobs = files.map(({ file, dest }) => ({ id: nextId++, file, dest, ctrl: new AbortController() }));
      queue.current.push(...jobs);
      setItems((xs) =>
        [
          ...jobs.map((j) => ({ id: j.id, name: j.file.name, dest: j.dest, size: j.file.size, progress: 0, status: "pending" as const })),
          ...xs,
        ].slice(0, 200),
      );
      jobs.forEach((j) => ctrlMap.current.set(j.id, j.ctrl));
      pump();
    },
    [pump],
  );

  const cancel = (id: number) => {
    ctrlMap.current.get(id)?.abort();
    setItems((xs) => xs.map((x) => (x.id === id && x.status === "pending" ? { ...x, status: "cancelled" } : x)));
  };
  const cancelAll = () => items.forEach((x) => (x.status === "pending" || x.status === "running") && cancel(x.id));
  const clear = () => setItems([]);

  return { items, enqueue, cancel, cancelAll, clear };
}

export function TransferPanel({
  items,
  onCancel,
  onCancelAll,
  onClose,
}: {
  items: Transfer[];
  onCancel: (id: number) => void;
  onCancelAll: () => void;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const active = items.filter((x) => x.status === "running" || x.status === "pending").length;
  const done = items.filter((x) => x.status === "done").length;
  const failed = items.filter((x) => x.status === "failed").length;

  const title = active
    ? `در حال آپلود ${faNum(active)} مورد`
    : failed
      ? `${faNum(done)} آپلود انجام شد، ${faNum(failed)} ناموفق`
      : `${faNum(done)} آپلود انجام شد`;

  return (
    <AnimatePresence>
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="fixed bottom-5 left-5 z-40 w-[360px] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-soft"
        >
          <div className="flex h-14 items-center gap-1 bg-surface-2 pe-2 ps-5">
            <span className="flex-1 text-[15px] font-medium">{title}</span>
            <IconButton label={collapsed ? "باز کردن" : "جمع کردن"} onClick={() => setCollapsed((c) => !c)} className="size-9">
              <ChevronDown className={cn("size-5 transition-transform", collapsed && "rotate-180")} />
            </IconButton>
            <IconButton
              label={active ? "لغو همه" : "بستن"}
              onClick={() => (active ? onCancelAll() : onClose())}
              className="size-9"
            >
              <X className="size-5" />
            </IconButton>
          </div>
          <motion.div
            initial={false}
            animate={{ height: collapsed ? 0 : "auto" }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <ul className="scroll-thin max-h-72 overflow-y-auto py-1">
              {items.map((t) => (
                <li key={t.id} className="group flex h-14 items-center gap-3 px-5 hover:bg-hover/60">
                  <FileIcon kind={kindOf(t.name, false)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      <bdi>{t.name}</bdi>
                    </div>
                    <div className={cn("truncate text-xs", t.status === "failed" ? "text-danger" : "text-faint")}>
                      {t.status === "failed"
                        ? t.error
                        : t.status === "running"
                          ? `${formatBytes(t.size * t.progress)} از ${formatBytes(t.size)}`
                          : t.status === "cancelled"
                            ? "لغو شد"
                            : formatBytes(t.size)}
                    </div>
                  </div>
                  {(t.status === "pending" || t.status === "running") && (
                    <button
                      onClick={() => onCancel(t.id)}
                      className="hidden size-7 place-items-center rounded-full text-muted hover:bg-hover group-hover:grid"
                      title="لغو"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                  <span className={cn((t.status === "pending" || t.status === "running") && "group-hover:hidden")}>
                    <StatusMark
                      status={t.status}
                      progress={t.status === "running" ? t.progress : undefined}
                      color="var(--primary)"
                      doneColor="var(--success)"
                      errorColor="var(--danger)"
                      size={22}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  FolderX,
  Lock,
  CloudUpload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button, Dialog, Field, IconButton, Menu, type MenuItem } from "@/components/ui";
import { api, ApiError, type DeviceInfo, type Entry } from "@/lib/api";
import { baseName, faNum, joinPath, parentOf } from "@/lib/format";
import { saveWatch } from "@/lib/saved";
import { cn } from "@/lib/utils";
import { FileView, type SortKey, type ViewMode } from "./FileView";
import { DropOverlay, Preview, UndoToast, type PendingDelete } from "./Overlays";
import { PLACES, Sidebar } from "./Sidebar";
import { TransferPanel, useTransfers } from "./Transfers";
import { LiveView } from "@/mirror/LiveView";

const DELETE_DELAY = 6;

function pref<T>(key: string, fallback: T): [T, (v: T) => void] {
  let v = fallback;
  try {
    const raw = localStorage.getItem(`watch-drive:${key}`);
    if (raw !== null) v = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [v, (next: T) => {
    try {
      localStorage.setItem(`watch-drive:${key}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }];
}

function usePref<T>(key: string, fallback: T) {
  const [initial, persist] = useMemo(() => pref(key, fallback), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = useState<T>(initial);
  return [v, (n: T) => (setV(n), persist(n))] as const;
}

/** Current folder lives in the URL hash so browser back/forward works. */
function useHashPath(fallback: string) {
  const read = () => decodeURIComponent(location.hash.slice(1)) || fallback;
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = useCallback((p: string) => {
    location.hash = encodeURIComponent(p).replace(/%2F/g, "/");
  }, []);
  return [path, navigate] as const;
}

/** Flatten a drop (files and whole folders) into files with relative paths. */
async function collectDrop(dt: DataTransfer): Promise<{ file: File; rel: string }[]> {
  const roots = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!roots.length) return [...dt.files].map((f) => ({ file: f, rel: f.name }));
  const out: { file: File; rel: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, rel: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const r of roots) await walk(r, "");
  return out;
}

export function Drive({ serial, onDisconnect }: { serial: string; onDisconnect: () => void }) {
  const [path, navigate] = useHashPath("/sdcard");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [info, setInfo] = useState<DeviceInfo>();
  const [view, setView] = usePref<ViewMode>("view", "list");
  const [showHidden, setShowHidden] = usePref("hidden", false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [nameDialog, setNameDialog] = useState<{ mode: "mkdir" | "rename"; entry?: Entry } | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(PendingDelete & { paths: string[] }) | null>(null);
  const deleteTimer = useRef<number>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [toast, setToast] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  /* ---------------------------------- data --------------------------------- */

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setEntries(await api.ls(serial, path));
        setError(null);
      } catch (e) {
        setError(e as ApiError);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [serial, path],
  );

  useEffect(() => {
    setSelected(new Set());
    setQuery("");
    anchor.current = null;
    load();
  }, [load]);

  useEffect(() => {
    api
      .info(serial)
      .then((i) => {
        setInfo(i);
        saveWatch({ name: i.model });
      })
      .catch(() => {});
  }, [serial]);

  const pathRef = useRef(path);
  pathRef.current = path;
  const onUploadsSettled = useCallback(
    (dirs: string[]) => {
      if (dirs.some((d) => d === pathRef.current || d.startsWith(pathRef.current + "/"))) load(true);
      api.info(serial).then(setInfo).catch(() => {});
    },
    [load, serial],
  );
  const transfers = useTransfers(serial, onUploadsSettled);

  const hiddenByDelete = useMemo(() => new Set(pendingDelete?.paths), [pendingDelete]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = entries.filter(
      (e) => (showHidden || !e.name.startsWith(".")) && !hiddenByDelete.has(e.path) && (!q || e.name.toLowerCase().includes(q)),
    );
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const ad = a.type === "dir" ? 0 : 1;
      const bd = b.type === "dir" ? 0 : 1;
      if (ad !== bd) return ad - bd;
      if (sort.key === "size" && a.size !== b.size) return (a.size - b.size) * dir;
      if (sort.key === "mtime" && a.mtime !== b.mtime) return (a.mtime - b.mtime) * dir;
      return a.name.localeCompare(b.name, "fa", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [entries, showHidden, hiddenByDelete, query, sort]);

  const previewable = useMemo(() => visible.filter((e) => e.type === "file"), [visible]);
  const selection = visible.filter((e) => selected.has(e.path));

  /* -------------------------------- actions -------------------------------- */

  const open = (e: Entry) => {
    if (e.type === "dir") return navigate(e.path);
    setPreviewIdx(previewable.findIndex((p) => p.path === e.path));
  };

  const download = (items: Entry[]) => {
    items.forEach((e, i) =>
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = api.fileUrl(serial, e.path);
        a.download = "";
        a.click();
      }, i * 350),
    );
    flash(items.length === 1 ? `دانلود «${items[0].name}» شروع شد` : `دانلود ${faNum(items.length)} مورد شروع شد`);
  };

  const commitDelete = useCallback(
    async (paths: string[]) => {
      try {
        await api.remove(serial, paths);
        api.info(serial).then(setInfo).catch(() => {});
      } catch (e) {
        flash((e as Error).message);
      }
      await load(true);
    },
    [serial, load, flash],
  );

  const requestDelete = (items: Entry[]) => {
    if (!items.length) return;
    // A second delete flushes the previous one immediately.
    if (pendingDelete) {
      window.clearTimeout(deleteTimer.current);
      commitDelete(pendingDelete.paths);
    }
    const paths = items.map((e) => e.path);
    const pd = {
      id: Date.now(),
      paths,
      seconds: DELETE_DELAY,
      label: items.length === 1 ? `«${items[0].name}» حذف شد` : `${faNum(items.length)} مورد حذف شد`,
    };
    setPendingDelete(pd);
    setSelected(new Set());
    deleteTimer.current = window.setTimeout(() => {
      setPendingDelete((cur) => (cur?.id === pd.id ? null : cur));
      commitDelete(paths);
    }, DELETE_DELAY * 1000);
  };

  const undoDelete = () => {
    window.clearTimeout(deleteTimer.current);
    setPendingDelete(null);
  };

  const duplicate = async (e: Entry) => {
    const dot = e.type === "file" ? e.name.lastIndexOf(".") : -1;
    const name = dot > 0 ? `${e.name.slice(0, dot)} (کپی)${e.name.slice(dot)}` : `${e.name} (کپی)`;
    try {
      await api.copy(serial, e.path, joinPath(path, name));
      await load(true);
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const moveInto = async (paths: string[], folder: Entry) => {
    try {
      for (const p of paths) await api.move(serial, p, joinPath(folder.path, baseName(p)));
      flash(`${faNum(paths.length)} مورد به «${folder.name}» منتقل شد`);
    } catch (e) {
      flash((e as Error).message);
    }
    setSelected(new Set());
    load(true);
  };

  const upload = async (files: { file: File; rel: string }[], into = path) => {
    if (!files.length) return;
    const dirs = [...new Set(files.map((f) => f.rel.split("/").slice(0, -1).join("/")).filter(Boolean))];
    try {
      for (const d of dirs.sort()) await api.mkdir(serial, joinPath(into, d));
    } catch (e) {
      return flash((e as Error).message);
    }
    if (dirs.length) load(true);
    transfers.enqueue(files.map(({ file, rel }) => ({ file, dest: joinPath(into, rel) })));
  };

  const submitName = async (name: string) => {
    if (!nameDialog) return;
    if (nameDialog.mode === "mkdir") {
      await api.mkdir(serial, joinPath(path, name));
    } else if (nameDialog.entry && name !== nameDialog.entry.name) {
      await api.move(serial, nameDialog.entry.path, joinPath(path, name));
    }
    setNameDialog(null);
    await load(true);
    setSelected(new Set([joinPath(path, name)]));
  };

  /* ------------------------------- selection ------------------------------- */

  const onItemClick = (e: MouseEvent, entry: Entry, index: number) => {
    e.stopPropagation();
    const idx = visible.indexOf(entry);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, idx].sort((x, y) => x - y);
      setSelected(new Set(visible.slice(a, b + 1).map((x) => x.path)));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(entry.path)) n.delete(entry.path);
        else n.add(entry.path);
        return n;
      });
    } else {
      setSelected(new Set([entry.path]));
    }
    anchor.current = idx >= 0 ? idx : index;
  };

  const itemMenu = (e: MouseEvent, entry: Entry) => {
    e.preventDefault();
    e.stopPropagation();
    const targets = selected.has(entry.path) ? selection : [entry];
    if (!selected.has(entry.path)) setSelected(new Set([entry.path]));
    const single = targets.length === 1;
    setMenu({
      at: { x: e.clientX, y: e.clientY },
      items: [
        ...(single
          ? [{ label: entry.type === "dir" ? "باز کردن" : "پیش‌نمایش", icon: entry.type === "dir" ? <FolderOpen /> : <Eye />, onSelect: () => open(entry) }]
          : []),
        { label: single && entry.type === "dir" ? "دانلود (tar)" : "دانلود", icon: <Download />, onSelect: () => download(targets) },
        { label: "تغییر نام", icon: <Pencil />, onSelect: () => setNameDialog({ mode: "rename", entry }), disabled: !single, divider: true, hint: "F2" },
        { label: "ساختن کپی", icon: <Copy />, onSelect: () => duplicate(entry), disabled: !single },
        { label: "حذف", icon: <Trash2 />, onSelect: () => requestDelete(targets), danger: true, divider: true, hint: "Del" },
      ],
    });
  };

  const bgMenu = (e: MouseEvent) => {
    e.preventDefault();
    setSelected(new Set());
    setMenu({
      at: { x: e.clientX, y: e.clientY },
      items: [
        { label: "پوشهٔ جدید", icon: <FolderPlus />, onSelect: () => setNameDialog({ mode: "mkdir" }) },
        { label: "آپلود فایل", icon: <Upload />, onSelect: () => fileInput.current?.click(), divider: true },
        { label: "آپلود پوشه", icon: <FolderUp />, onSelect: () => folderInput.current?.click() },
        { label: "تازه‌سازی", icon: <RefreshCw />, onSelect: () => load(), divider: true },
      ],
    });
  };

  /* -------------------------------- keyboard ------------------------------- */

  const keyState = { selection, visible, nameDialog, previewIdx };
  const keyRef = useRef(keyState);
  keyRef.current = keyState;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { selection, visible, nameDialog, previewIdx } = keyRef.current;
      if (nameDialog || previewIdx !== null) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "Escape") setSelected(new Set());
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(visible.map((x) => x.path)));
      } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) requestDelete(selection);
      else if (e.key === "F2" && selection.length === 1) setNameDialog({ mode: "rename", entry: selection[0] });
      else if (e.key === "Enter" && selection.length === 1) open(selection[0]);
      else if (e.key === "Backspace" && path !== "/") navigate(parentOf(path));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------------------------- view --------------------------------- */

  const crumbs = useMemo(() => {
    const out: { label: string; path: string }[] = [];
    const sd = path === "/sdcard" || path.startsWith("/sdcard/");
    if (sd) out.push({ label: "حافظهٔ ساعت", path: "/sdcard" });
    else out.push({ label: "ریشه", path: "/" });
    const rest = (sd ? path.slice("/sdcard".length) : path).split("/").filter(Boolean);
    let acc = sd ? "/sdcard" : "";
    for (const seg of rest) {
      acc += `/${seg}`;
      out.push({ label: seg, path: acc });
    }
    return out;
  }, [path]);

  const place = PLACES.find((p) => p.path === path);
  const title = place?.label ?? crumbs[crumbs.length - 1].label;

  return (
    <div className="flex h-full">
      <Sidebar
        path={path}
        info={info}
        onNavigate={navigate}
        onNewFolder={() => setNameDialog({ mode: "mkdir" })}
        onUploadFiles={() => fileInput.current?.click()}
        onUploadFolder={() => folderInput.current?.click()}
        onDisconnect={onDisconnect}
        liveOpen={live}
        onToggleLive={() => setLive((v) => !v)}
      />

      <div className="flex min-w-0 flex-1 flex-col pe-4">
        {/* search bar */}
        <div className="flex h-16 shrink-0 items-center gap-2">
          <label className="flex h-12 max-w-[720px] flex-1 items-center gap-3 rounded-full bg-surface-2 px-4 transition focus-within:bg-surface focus-within:shadow-soft">
            <Search className="size-5 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`جستجو در «${title}»`}
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted hover:text-fg">
                <X className="size-5" />
              </button>
            )}
          </label>
        </div>

        {/* main surface */}
        <main
          className="relative mb-4 flex min-h-0 flex-1 flex-col rounded-3xl bg-surface"
          onClick={() => setSelected(new Set())}
          onContextMenu={bgMenu}
          onDragEnter={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            dragDepth.current++;
            setDragging(true);
          }}
          onDragLeave={() => {
            if (--dragDepth.current <= 0) setDragging(false);
          }}
          onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
          onDrop={async (e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            upload(await collectDrop(e.dataTransfer));
          }}
        >
          {/* title row / selection bar */}
          <div className="flex h-16 shrink-0 items-center gap-2 px-4" onClick={(e) => e.stopPropagation()}>
            <AnimatePresence mode="wait" initial={false}>
              {selection.length > 0 ? (
                <motion.div
                  key="sel"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="flex h-12 flex-1 items-center gap-1 rounded-full bg-surface-2 pe-2 ps-1"
                >
                  <IconButton label="لغو انتخاب" onClick={() => setSelected(new Set())}>
                    <X className="size-5" />
                  </IconButton>
                  <span className="me-3 text-sm font-medium">{faNum(selection.length)} مورد انتخاب شد</span>
                  <IconButton label="دانلود" onClick={() => download(selection)}>
                    <Download className="size-5" />
                  </IconButton>
                  <IconButton label="حذف" onClick={() => requestDelete(selection)}>
                    <Trash2 className="size-5" />
                  </IconButton>
                  {selection.length === 1 && (
                    <IconButton label="تغییر نام" onClick={() => setNameDialog({ mode: "rename", entry: selection[0] })}>
                      <Pencil className="size-5" />
                    </IconButton>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="title"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="flex min-w-0 flex-1 items-center gap-0.5"
                >
                  {crumbs.map((c, i) => {
                    const last = i === crumbs.length - 1;
                    return (
                      <span key={c.path} className={cn("flex min-w-0 items-center", !last && "shrink-[2]")}>
                        <button
                          dir="auto"
                          onClick={(e) => (last ? bgMenu(e) : navigate(c.path))}
                          className={cn(
                            "truncate rounded-full px-3 py-1.5 transition-colors hover:bg-hover",
                            last ? "text-[22px] text-fg" : "text-[22px] text-muted",
                          )}
                        >
                          {c.label}
                        </button>
                        {!last && <ChevronLeft className="size-5 shrink-0 text-faint" />}
                      </span>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex shrink-0 items-center gap-1">
              <IconButton label={showHidden ? "پنهان کردن فایل‌های مخفی" : "نمایش فایل‌های مخفی"} onClick={() => setShowHidden(!showHidden)} active={showHidden}>
                {showHidden ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
              </IconButton>
              <IconButton label="تازه‌سازی" onClick={() => load()}>
                <RefreshCw className={cn("size-5", loading && "animate-spin")} />
              </IconButton>
              <div className="ms-1 flex h-10 overflow-hidden rounded-full border border-line">
                {(["list", "grid"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setView(m)}
                    title={m === "list" ? "نمای فهرست" : "نمای شبکه‌ای"}
                    className={cn("grid w-12 place-items-center transition-colors", view === m ? "bg-primary-soft text-fg" : "text-muted hover:bg-hover")}
                  >
                    {m === "list" ? <List className="size-[18px]" /> : <LayoutGrid className="size-[18px]" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            {loading && !entries.length ? (
              <Skeleton view={view} />
            ) : error ? (
              <Empty
                icon={error.code === "DENIED" ? <Lock /> : <FolderX />}
                title={error.code === "DENIED" ? "دسترسی به این پوشه مجاز نیست" : error.code === "NOT_FOUND" ? "این پوشه روی ساعت وجود ندارد" : "خواندن پوشه ممکن نشد"}
                body={error.code === "DENIED" ? "بدون روت، فقط حافظهٔ داخلی (/sdcard) و چند پوشهٔ سیستمی قابل خواندن‌اند." : error.message}
                action={
                  error.code === "NOT_FOUND" && path.startsWith("/sdcard/") ? (
                    <Button variant="tonal" icon={<FolderPlus className="size-4" />} onClick={() => api.mkdir(serial, path).then(() => load())}>
                      ساختن این پوشه
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => navigate("/sdcard")}>
                      رفتن به حافظهٔ ساعت
                    </Button>
                  )
                }
              />
            ) : visible.length === 0 ? (
              query ? (
                <Empty icon={<Search />} title="چیزی پیدا نشد" body={`هیچ موردی با «${query}» در این پوشه نیست.`} />
              ) : (
                <Empty
                  icon={<CloudUpload />}
                  title="این پوشه خالی است"
                  body="فایل‌ها یا پوشه‌ها را اینجا رها کنید، یا از دکمهٔ «جدید» استفاده کنید."
                  action={
                    <Button variant="tonal" icon={<Upload className="size-4" />} onClick={() => fileInput.current?.click()}>
                      آپلود فایل
                    </Button>
                  }
                />
              )
            ) : (
              <FileView
                serial={serial}
                entries={visible}
                view={view}
                selected={selected}
                sort={sort}
                onSort={(key) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
                onItemClick={onItemClick}
                onOpen={open}
                onMenu={itemMenu}
                onMoveInto={moveInto}
              />
            )}
          </div>

          <DropOverlay show={dragging} target={title} />
        </main>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          upload([...(e.target.files ?? [])].map((f) => ({ file: f, rel: f.name })));
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...({ webkitdirectory: "" } as object)}
        onChange={(e) => {
          upload([...(e.target.files ?? [])].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name })));
          e.target.value = "";
        }}
      />

      <Menu at={menu?.at ?? null} items={menu?.items ?? []} onClose={() => setMenu(null)} />
      <NameDialog
        state={nameDialog}
        existing={entries.map((e) => e.name)}
        onClose={() => setNameDialog(null)}
        onSubmit={submitName}
      />
      <Preview serial={serial} entries={previewable} index={previewIdx} onIndex={setPreviewIdx} onClose={() => setPreviewIdx(null)} />
      <TransferPanel items={transfers.items} onCancel={transfers.cancel} onCancelAll={transfers.cancelAll} onClose={transfers.clear} />
      <AnimatePresence>{live && <LiveView serial={serial} onClose={() => setLive(false)} />}</AnimatePresence>
      <UndoToast pending={pendingDelete} onUndo={undoDelete} />
      <Snackbar message={pendingDelete ? null : toast} />
    </div>
  );
}

/* --------------------------------- helpers -------------------------------- */

function NameDialog({
  state,
  existing,
  onClose,
  onSubmit,
}: {
  state: { mode: "mkdir" | "rename"; entry?: Entry } | null;
  existing: string[];
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state) return;
    const initial = state.mode === "rename" ? state.entry!.name : "پوشهٔ بی‌نام";
    setName(initial);
    setError(undefined);
    setBusy(false);
    setTimeout(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const dot = state.mode === "rename" && state.entry?.type === "file" ? initial.lastIndexOf(".") : -1;
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, 60);
  }, [state]);

  const trimmed = name.trim();
  const invalid = !trimmed || trimmed.includes("/") || trimmed === "." || trimmed === "..";
  const taken = trimmed !== state?.entry?.name && existing.includes(trimmed);

  return (
    <Dialog open={!!state} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (invalid || taken) return;
          setBusy(true);
          try {
            await onSubmit(trimmed);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <h2 className="mb-5 text-xl">{state?.mode === "mkdir" ? "پوشهٔ جدید" : "تغییر نام"}</h2>
        <Field
          ref={input}
          label="نام"
          dir="auto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint={taken ? <span className="text-danger">موردی با این نام وجود دارد</span> : error ? <span className="text-danger">{error}</span> : undefined}
        />
        <div className="mt-6 flex justify-start gap-2">
          <Button type="submit" loading={busy} disabled={invalid || taken}>
            {state?.mode === "mkdir" ? "ساختن" : "ذخیره"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            لغو
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-full min-h-80 flex-col items-center justify-center text-center"
    >
      <div className="mb-5 grid size-24 place-items-center rounded-full bg-surface-2 text-primary [&>svg]:size-10 [&>svg]:stroke-[1.5]">
        {icon}
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-7 text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

function Skeleton({ view }: { view: ViewMode }) {
  if (view === "grid")
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 pt-9">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-2xl bg-surface-2" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    );
  return (
    <div className="pt-12">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 border-b border-line px-4">
          <div className="size-5 animate-pulse rounded bg-surface-2" />
          <div className="h-3 animate-pulse rounded-full bg-surface-2" style={{ width: `${30 + ((i * 37) % 40)}%`, animationDelay: `${i * 80}ms` }} />
        </div>
      ))}
    </div>
  );
}

function Snackbar({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center">
          <motion.div
            key={message}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-2xl bg-[#2b2d31] px-5 py-3.5 text-sm text-white shadow-soft dark:bg-[#e6e8ec] dark:text-[#1b1c1f]"
          >
            {message}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}


import { motion } from "motion/react";
import { ArrowDown, ArrowUp, MoreVertical } from "lucide-react";
import { useState, type DragEvent, type MouseEvent } from "react";
import { api, type Entry } from "@/lib/api";
import { formatBytes, formatDate, kindOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FileIcon } from "./FileIcon";

export type SortKey = "name" | "mtime" | "size";
export type ViewMode = "list" | "grid";

const DRAG_TYPE = "application/x-watch-paths";

interface Props {
  serial: string;
  entries: Entry[];
  view: ViewMode;
  selected: Set<string>;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  onItemClick: (e: MouseEvent, entry: Entry, index: number) => void;
  onOpen: (entry: Entry) => void;
  onMenu: (e: MouseEvent, entry: Entry) => void;
  onMoveInto: (paths: string[], folder: Entry) => void;
}

/** Drag items onto a folder to move them there. */
function useFolderDrop(entry: Entry, selected: Set<string>, onMoveInto: Props["onMoveInto"]) {
  const [over, setOver] = useState(false);
  const isFolder = entry.type === "dir";
  return {
    over,
    handlers: {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        const paths = selected.has(entry.path) ? [...selected] : [entry.path];
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: DragEvent) => {
        if (!isFolder || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        if (!isFolder || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        const paths = (JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[]).filter((p) => p !== entry.path);
        if (paths.length) onMoveInto(paths, entry);
      },
    },
  };
}

export function FileView(props: Props) {
  return props.view === "list" ? <ListView {...props} /> : <GridView {...props} />;
}

/* ---------------------------------- list ---------------------------------- */

function ListView({ entries, sort, onSort, ...rest }: Props) {
  const Head = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <button
      onClick={() => onSort(k)}
      className={cn("flex h-full items-center gap-1 text-start hover:text-fg", sort.key === k && "text-fg", className)}
    >
      {children}
      {sort.key === k && (sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
    </button>
  );

  return (
    <div role="grid" className="text-sm">
      <div className="sticky top-0 z-10 grid h-12 grid-cols-[minmax(0,1fr)_9rem_7rem_2.5rem] items-center gap-4 border-b border-line bg-surface px-4 text-[13px] font-medium text-muted">
        <Head k="name">نام</Head>
        <Head k="mtime" className="max-md:hidden">آخرین تغییر</Head>
        <Head k="size" className="max-md:hidden">اندازه</Head>
        <span />
      </div>
      {entries.map((e, i) => (
        <ListRow key={e.path} entry={e} index={i} {...rest} />
      ))}
    </div>
  );
}

function ListRow({
  entry,
  index,
  selected,
  onItemClick,
  onOpen,
  onMenu,
  onMoveInto,
}: Omit<Props, "entries" | "view" | "sort" | "onSort" | "serial"> & { entry: Entry; index: number }) {
  const isSel = selected.has(entry.path);
  const { over, handlers } = useFolderDrop(entry, selected, onMoveInto);
  const isDir = entry.type === "dir";
  return (
    <motion.div
      role="row"
      aria-selected={isSel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, delay: Math.min(index, 20) * 0.012 }}
      {...(handlers as object)}
      onClick={(ev) => onItemClick(ev, entry, index)}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(ev) => onMenu(ev, entry)}
      className={cn(
        "group grid h-12 cursor-default select-none grid-cols-[minmax(0,1fr)_9rem_7rem_2.5rem] items-center gap-4 border-b border-line px-4 transition-colors",
        isSel ? "bg-selected" : "hover:bg-hover",
        over && "bg-primary-soft ring-2 ring-inset ring-primary",
      )}
    >
      <span className="flex min-w-0 items-center gap-4">
        <FileIcon kind={kindOf(entry.name, isDir)} />
        <span className="truncate">
          <bdi>{entry.name}</bdi>
        </span>
      </span>
      <span className="text-muted max-md:hidden">{formatDate(entry.mtime)}</span>
      <span className="text-muted max-md:hidden">{isDir ? "—" : formatBytes(entry.size)}</span>
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onMenu(ev, entry);
        }}
        className="grid size-8 place-items-center rounded-full text-muted opacity-0 transition hover:bg-black/5 group-hover:opacity-100 dark:hover:bg-white/10"
        title="گزینه‌های بیشتر"
      >
        <MoreVertical className="size-[18px]" />
      </button>
    </motion.div>
  );
}

/* ---------------------------------- grid ---------------------------------- */

function GridView({ entries, ...rest }: Props) {
  const folders = entries.map((e, i) => [e, i] as const).filter(([e]) => e.type === "dir");
  const files = entries.map((e, i) => [e, i] as const).filter(([e]) => e.type !== "dir");
  return (
    <div className="space-y-6 pt-2">
      {folders.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted">پوشه‌ها</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {folders.map(([e, i]) => (
              <GridCard key={e.path} entry={e} index={i} {...rest} />
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted">فایل‌ها</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {files.map(([e, i]) => (
              <GridCard key={e.path} entry={e} index={i} {...rest} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GridCard({
  serial,
  entry,
  index,
  selected,
  onItemClick,
  onOpen,
  onMenu,
  onMoveInto,
}: Omit<Props, "entries" | "view" | "sort" | "onSort"> & { entry: Entry; index: number }) {
  const isSel = selected.has(entry.path);
  const { over, handlers } = useFolderDrop(entry, selected, onMoveInto);
  const isDir = entry.type === "dir";
  const kind = kindOf(entry.name, isDir);
  const thumb = kind === "image" && entry.size < 4_000_000;

  const header = (
    <div className="flex h-12 items-center gap-3 pe-1 ps-4">
      <FileIcon kind={kind} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        <bdi>{entry.name}</bdi>
      </span>
      <button
        onClick={(ev) => {
          ev.stopPropagation();
          onMenu(ev, entry);
        }}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-black/5 dark:hover:bg-white/10"
        title="گزینه‌های بیشتر"
      >
        <MoreVertical className="size-[18px]" />
      </button>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 24) * 0.015 }}
      {...(handlers as object)}
      onClick={(ev) => onItemClick(ev, entry, index)}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(ev) => onMenu(ev, entry)}
      className={cn(
        "cursor-default select-none overflow-hidden rounded-2xl transition-colors",
        isSel ? "bg-selected" : "bg-surface-2 hover:bg-hover",
        over && "ring-2 ring-primary",
      )}
    >
      {header}
      {!isDir && (
        <div className="mx-2 mb-2 grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-surface">
          {thumb ? (
            <img src={api.fileUrl(serial, entry.path, true)} alt="" loading="lazy" className="size-full object-cover" draggable={false} />
          ) : (
            <FileIcon kind={kind} className="size-14 opacity-80" />
          )}
        </div>
      )}
    </motion.div>
  );
}

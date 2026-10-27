import { MonitorPlay, BatteryCharging, BatteryMedium, Download, FolderPlus, HardDrive, Image, Music, Plus, Server, Unplug, Upload, FolderUp, Camera } from "lucide-react";
import { useState } from "react";
import { Menu, IconButton } from "@/components/ui";
import { WatchGlyph } from "@/wizard/ConnectWizard";
import type { DeviceInfo } from "@/lib/api";
import { faNum, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export const PLACES = [
  { path: "/sdcard", label: "حافظهٔ ساعت", Icon: HardDrive },
  { path: "/sdcard/Download", label: "دانلودها", Icon: Download },
  { path: "/sdcard/Music", label: "موسیقی", Icon: Music },
  { path: "/sdcard/Pictures", label: "تصاویر", Icon: Image },
  { path: "/sdcard/DCIM", label: "دوربین و اسکرین‌شات", Icon: Camera },
  { path: "/", label: "ریشهٔ سیستم", Icon: Server },
];

export function Sidebar({
  path,
  info,
  onNavigate,
  onNewFolder,
  onUploadFiles,
  onUploadFolder,
  onDisconnect,
  liveOpen,
  onToggleLive,
}: {
  path: string;
  info?: DeviceInfo;
  onNavigate: (p: string) => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onDisconnect: () => void;
  liveOpen: boolean;
  onToggleLive: () => void;
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const active = [...PLACES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((p) => path === p.path || (p.path !== "/" && path.startsWith(p.path + "/")))?.path ?? "/";
  const used = info?.storage ? info.storage.used / info.storage.total : 0;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col px-3 pb-4">
      <div className="flex h-16 items-center gap-2.5 px-3">
        <WatchGlyph className="size-8" />
        <span className="text-[19px] font-medium tracking-tight">Watch Drive</span>
      </div>

      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt({ x: r.right, y: r.top });
        }}
        className="mb-4 mt-1 flex h-14 w-fit items-center gap-3 rounded-2xl bg-surface pe-6 ps-4 text-sm font-medium shadow-soft transition hover:bg-primary-soft/50 active:scale-[0.98]"
      >
        <Plus className="size-6" strokeWidth={1.6} />
        جدید
      </button>
      <Menu
        at={menuAt}
        onClose={() => setMenuAt(null)}
        items={[
          { label: "پوشهٔ جدید", icon: <FolderPlus />, onSelect: onNewFolder },
          { label: "آپلود فایل", icon: <Upload />, onSelect: onUploadFiles, divider: true },
          { label: "آپلود پوشه", icon: <FolderUp />, onSelect: onUploadFolder },
        ]}
      />

      <nav className="space-y-0.5">
        {PLACES.map(({ path: p, label, Icon }) => (
          <button
            key={p}
            onClick={() => onNavigate(p)}
            className={cn(
              "flex h-9 w-full items-center gap-4 rounded-full px-4 text-sm transition-colors",
              active === p ? "bg-primary-soft font-medium text-fg" : "text-fg/85 hover:bg-hover",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={active === p ? 2.1 : 1.7} />
            {label}
          </button>
        ))}
      </nav>

      <div className="mx-4 my-3 h-px bg-line" />
      <button
        onClick={onToggleLive}
        className={cn(
          "flex h-9 w-full items-center gap-4 rounded-full px-4 text-sm transition-colors",
          liveOpen ? "bg-primary-soft font-medium text-fg" : "text-fg/85 hover:bg-hover",
        )}
      >
        <MonitorPlay className="size-[18px]" strokeWidth={liveOpen ? 2.1 : 1.7} />
        نمایش زنده
        {liveOpen && <span className="ms-auto size-2 rounded-full bg-success" />}
      </button>

      <div className="mt-auto rounded-3xl p-3">
        {info?.storage && (
          <div className="mb-4 px-1">
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(2, used * 100)}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted">
              {formatBytes(info.storage.used)} از {formatBytes(info.storage.total)} استفاده شده
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <WatchGlyph className="size-8" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{info?.model || "ساعت"}</div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-success" />
              وصل
              {info?.battery !== undefined && (
                <span className="ms-1.5 flex items-center gap-0.5">
                  {info.charging ? <BatteryCharging className="size-3.5" /> : <BatteryMedium className="size-3.5" />}
                  {faNum(info.battery)}٪
                </span>
              )}
            </div>
          </div>
          <IconButton label="قطع اتصال" onClick={onDisconnect} className="size-8">
            <Unplug className="size-4" />
          </IconButton>
        </div>
      </div>
    </aside>
  );
}

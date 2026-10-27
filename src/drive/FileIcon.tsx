import { Archive, File, FileText, Film, Folder, Image, Music, Package, FileType2 } from "lucide-react";
import type { FileKind } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAP: Record<FileKind, { Icon: typeof File; color: string }> = {
  folder: { Icon: Folder, color: "#5f6368" },
  image: { Icon: Image, color: "#d93025" },
  audio: { Icon: Music, color: "#a142f4" },
  video: { Icon: Film, color: "#e8710a" },
  text: { Icon: FileText, color: "#1a73e8" },
  archive: { Icon: Archive, color: "#80868b" },
  apk: { Icon: Package, color: "#188038" },
  pdf: { Icon: FileType2, color: "#ea4335" },
  other: { Icon: File, color: "#80868b" },
};

export function FileIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const { Icon, color } = MAP[kind];
  return (
    <Icon
      className={cn("size-5 shrink-0", kind === "folder" && "text-muted", className)}
      style={kind === "folder" ? undefined : { color }}
      fill={kind === "folder" ? "currentColor" : "none"}
      fillOpacity={kind === "folder" ? 0.9 : undefined}
      strokeWidth={kind === "folder" ? 1.4 : 1.8}
    />
  );
}

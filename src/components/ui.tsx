import { AnimatePresence, motion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export const EASE = [0.22, 1, 0.36, 1] as const;

type Variant = "primary" | "tonal" | "ghost" | "danger" | "outline";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:brightness-110 shadow-sm",
  tonal: "bg-primary-soft text-fg hover:brightness-[0.97]",
  ghost: "text-primary hover:bg-primary-soft/60",
  danger: "bg-danger text-white hover:brightness-110",
  outline: "border border-line text-fg hover:bg-hover",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode; loading?: boolean }
>(function Button({ variant = "primary", icon, loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-10 select-none items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg",
        "focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40",
        active && "bg-primary-soft text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4 animate-spin", className)} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; ltr?: boolean }
>(function Field({ label, hint, ltr, className, ...rest }, ref) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      <input
        ref={ref}
        dir={ltr ? "ltr" : undefined}
        className={cn(
          "h-12 w-full rounded-xl border border-line bg-surface px-4 text-[15px] outline-none transition-[border,box-shadow]",
          "placeholder:text-faint focus:border-primary focus:ring-4 focus:ring-primary/15",
          ltr && "text-left tabular-nums",
        )}
        {...rest}
      />
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
});

/* --------------------------------- Dialog --------------------------------- */

export function Dialog({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            dir="rtl"
            className={cn("w-full max-w-sm rounded-3xl bg-surface p-6 shadow-soft", className)}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------------------------------- Menu ---------------------------------- */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
  divider?: boolean;
  disabled?: boolean;
}

/** Floating menu anchored at a viewport point; flips to stay on screen. */
export function Menu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(at);
    const r = ref.current.getBoundingClientRect();
    // RTL: menus open towards the left of the anchor.
    let x = at.x - r.width;
    if (x < 8) x = Math.min(at.x, window.innerWidth - r.width - 8);
    const y = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height) : at.y;
    setPos({ x, y });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [at, onClose]);

  return createPortal(
    <AnimatePresence>
      {at && (
        <motion.div
          ref={ref}
          dir="rtl"
          role="menu"
          className="fixed z-50 min-w-52 rounded-2xl border border-line bg-surface py-2 shadow-soft"
          style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: EASE }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.divider && <div className="my-1.5 h-px bg-line" />}
              <button
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  it.onSelect();
                }}
                className={cn(
                  "flex h-10 w-full items-center gap-3 px-4 text-start text-sm transition-colors hover:bg-hover disabled:opacity-40",
                  it.danger && "text-danger",
                )}
              >
                <span className={cn("text-muted [&>svg]:size-[18px]", it.danger && "text-danger")}>{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.hint && <kbd className="font-sans text-xs text-faint">{it.hint}</kbd>}
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

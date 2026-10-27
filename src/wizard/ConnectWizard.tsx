import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Bluetooth,
  KeyRound,
  Link2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StatusMark, type StatusMarkStatus } from "@/components/status-mark";
import { ReasoningText, TextShimmer } from "@/components/loading-states";
import { Button, EASE, Field } from "@/components/ui";
import { api, ApiError, type MdnsService } from "@/lib/api";
import { loadSaved, saveWatch, forgetWatch, type SavedWatch } from "@/lib/saved";
import { cn } from "@/lib/utils";

type Step = "welcome" | "prepare" | "pair" | "connect" | "done";

export interface WizardProps {
  /** Shown above the welcome card, e.g. after the connection dropped. */
  notice?: string;
  onConnected: (serial: string) => void;
}

const STEPS: { id: Step; label: string }[] = [
  { id: "prepare", label: "آماده‌سازی" },
  { id: "pair", label: "جفت‌سازی" },
  { id: "connect", label: "اتصال" },
];

/** Polls adb's mDNS browser while `active`; the watch advertises both pairing and connect ports. */
function useDiscovery(active: boolean) {
  const [services, setServices] = useState<MdnsService[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const tick = () =>
      api
        .discover()
        .then((s) => alive && setServices(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);
  return services;
}

export function ConnectWizard({ notice, onConnected }: WizardProps) {
  const [saved, setSaved] = useState<SavedWatch | null>(loadSaved);
  const [step, setStep] = useState<Step>("welcome");
  const [dir, setDir] = useState(1);
  const [host, setHost] = useState(saved?.host ?? "");
  const [pairNotice, setPairNotice] = useState<string>();
  const [serial, setSerial] = useState("");

  const go = (next: Step) => {
    const order: Step[] = ["welcome", "prepare", "pair", "connect", "done"];
    setDir(order.indexOf(next) >= order.indexOf(step) ? 1 : -1);
    setStep(next);
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[480px]">
        <Brand />

        <div className="relative mt-6 overflow-hidden rounded-[28px] border border-line bg-surface shadow-soft">
          {step !== "welcome" && step !== "done" && (
            <div className="flex items-center justify-between gap-2 border-b border-line px-6 py-4">
              {STEPS.map((s, i) => {
                const status: StatusMarkStatus = i < stepIndex ? "done" : i === stepIndex ? "running" : "pending";
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <StatusMark
                      status={status}
                      progress={status === "running" ? 0.25 + i * 0.25 : undefined}
                      label={<span className={cn("text-[13px]", status === "pending" ? "text-faint" : "text-fg")}>{s.label}</span>}
                      color="var(--primary)"
                      doneColor="var(--success)"
                      size={18}
                      fontSize={13}
                      strike={false}
                    />
                    {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-line sm:block" />}
                  </div>
                );
              })}
            </div>
          )}

          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * 24 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="p-6 sm:p-8"
            >
              {step === "welcome" && (
                <Welcome
                  saved={saved}
                  notice={notice}
                  onQuickConnect={() => go("connect")}
                  onRepair={() => go("pair")}
                  onStart={() => go("prepare")}
                  onForget={() => {
                    forgetWatch();
                    setSaved(null);
                    setHost("");
                  }}
                />
              )}
              {step === "prepare" && <Prepare onBack={() => go("welcome")} onNext={() => go("pair")} />}
              {step === "pair" && (
                <Pair
                  host={host}
                  notice={pairNotice}
                  onBack={() => go(saved ? "welcome" : "prepare")}
                  onSkip={() => go("connect")}
                  onPaired={(h) => {
                    setHost(h);
                    saveWatch({ host: h, pairedAt: Date.now() });
                    setSaved(loadSaved());
                    setPairNotice(undefined);
                    go("connect");
                  }}
                />
              )}
              {step === "connect" && (
                <Connect
                  host={host}
                  savedPort={saved?.host === host ? saved?.port : undefined}
                  onBack={() => go(saved ? "welcome" : "pair")}
                  onNeedPair={(msg) => {
                    setPairNotice(msg);
                    go("pair");
                  }}
                  onConnected={(s, h, port) => {
                    setHost(h);
                    saveWatch({ host: h, port, serial: s });
                    setSerial(s);
                    go("done");
                  }}
                />
              )}
              {step === "done" && <Done onContinue={() => onConnected(serial)} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <p className="mt-5 text-center text-xs text-faint">
          همه‌چیز روی همین کامپیوتر اجرا می‌شود — فایل‌ها مستقیم بین ساعت و سیستم شما جابه‌جا می‌شوند.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Brand() {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <WatchGlyph className="size-8" />
      <span className="text-lg font-semibold tracking-tight">Watch Drive</span>
    </div>
  );
}

export function WatchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="11" y="1.5" width="10" height="6" rx="2" fill="var(--primary)" opacity=".35" />
      <rect x="11" y="24.5" width="10" height="6" rx="2" fill="var(--primary)" opacity=".35" />
      <circle cx="16" cy="16" r="11" fill="var(--primary)" />
      <circle cx="16" cy="16" r="7" fill="var(--surface)" />
      <path d="M16 12v4l2.5 1.5" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Big watch illustration with radiating rings while searching. */
function WatchHero({ searching, icon }: { searching?: boolean; icon: ReactNode }) {
  return (
    <div className="relative mx-auto mb-6 grid size-28 place-items-center">
      {searching &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border-2 border-primary"
            initial={{ scale: 0.6, opacity: 0.5 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
          />
        ))}
      <div className="absolute top-0 h-5 w-12 rounded-t-xl bg-primary-soft" />
      <div className="absolute bottom-0 h-5 w-12 rounded-b-xl bg-primary-soft" />
      <div className="relative grid size-24 place-items-center rounded-full bg-primary shadow-[0_8px_30px_-6px_var(--primary)]">
        <div className="grid size-[76px] place-items-center rounded-full bg-surface text-primary [&>svg]:size-8">
          {icon}
        </div>
      </div>
    </div>
  );
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-xl font-semibold">{children}</h1>
      {sub && <p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-muted">{sub}</p>}
    </div>
  );
}

function Footer({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {onBack ? (
        <Button variant="ghost" onClick={onBack} icon={<ArrowRight className="size-4" />} className="px-3">
          بازگشت
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function ErrorNote({ children }: { children?: ReactNode }) {
  return (
    <AnimatePresence>
      {children && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="mt-4 rounded-2xl bg-danger/10 px-4 py-3 text-sm leading-6 text-danger">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------- welcome -------------------------------- */

function Welcome({
  saved,
  notice,
  onQuickConnect,
  onRepair,
  onStart,
  onForget,
}: {
  saved: SavedWatch | null;
  notice?: string;
  onQuickConnect: () => void;
  onRepair: () => void;
  onStart: () => void;
  onForget: () => void;
}) {
  if (!saved) {
    return (
      <>
        <WatchHero icon={<Sparkles />} />
        <Title sub="در سه قدم کوتاه ساعت را از طریق Wi‑Fi به این کامپیوتر وصل می‌کنیم؛ بعد فایل‌هایش را مثل یک درایو مرور کنید.">
          ساعتت را وصل کنیم
        </Title>
        <Button className="h-12 w-full text-[15px]" onClick={onStart} icon={<ArrowLeft className="size-4" />}>
          شروع
        </Button>
      </>
    );
  }

  return (
    <>
      <WatchHero icon={<Link2 />} />
      <Title sub={notice ?? "ساعت قبلاً با این کامپیوتر جفت شده است. فقط Wireless debugging روی ساعت روشن باشد."}>
        {notice ? "اتصال قطع شد" : "خوش برگشتی"}
      </Title>

      <div className="mb-5 flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
        <WatchGlyph className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{saved.name ?? "Galaxy Watch"}</div>
          <div className="ltr-nums text-xs text-muted">{saved.host}</div>
        </div>
        <button
          onClick={onForget}
          className="grid size-8 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg"
          title="فراموش کردن این ساعت"
        >
          <X className="size-4" />
        </button>
      </div>

      <Button className="h-12 w-full text-[15px]" onClick={onQuickConnect} icon={<Wifi className="size-4" />}>
        اتصال دوباره
      </Button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onRepair} icon={<KeyRound className="size-4" />}>
          جفت‌سازی از نو
        </Button>
        <Button variant="outline" onClick={onStart} icon={<Settings2 className="size-4" />}>
          راهنمای کامل
        </Button>
      </div>
    </>
  );
}

/* --------------------------------- prepare -------------------------------- */

function Crumbs({ items }: { items: string[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          <span dir="auto" className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg">
            {it}
          </span>
          {i < items.length - 1 && <ArrowLeft className="size-3 text-faint" />}
        </span>
      ))}
    </span>
  );
}

function Prepare({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [checked, setChecked] = useState<boolean[]>([false, false, false]);
  const items = [
    {
      title: "حالت توسعه‌دهنده را باز کنید",
      body: <>چند بار پشت‌سرهم روی «Software version» بزنید تا پیام فعال شدن بیاید.</>,
      path: ["Settings", "About watch", "Software information"],
    },
    {
      title: "ADB debugging را روشن کنید",
      body: <>داخل گزینه‌های توسعه‌دهنده، «ADB debugging» را فعال کنید.</>,
      path: ["Settings", "Developer options", "ADB debugging"],
    },
    {
      title: "Wireless debugging را روشن کنید",
      body: <>ساعت و این کامپیوتر باید روی یک Wi‑Fi باشند.</>,
      path: ["Developer options", "Wireless debugging"],
    },
  ];
  const all = checked.every(Boolean);

  return (
    <>
      <Title sub="این کارها را یک‌بار روی ساعت انجام دهید. هر مورد را که انجام دادید تیک بزنید.">
        ساعت را آماده کنید
      </Title>
      <ol className="space-y-2.5">
        {items.map((it, i) => (
          <li key={i}>
            <button
              onClick={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
              className={cn(
                "flex w-full gap-3 rounded-2xl border p-4 text-start transition-colors",
                checked[i] ? "border-transparent bg-primary-soft/50" : "border-line hover:bg-surface-2",
              )}
            >
              <span className="mt-0.5">
                <StatusMark
                  status={checked[i] ? "done" : "pending"}
                  doneColor="var(--success)"
                  color="var(--faint)"
                  size={20}
                  strike={false}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{it.title}</span>
                <span className="mt-0.5 block text-[13px] leading-6 text-muted">{it.body}</span>
                <Crumbs items={it.path} />
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-start gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-xs leading-6 text-muted">
        <Bluetooth className="mt-1 size-4 shrink-0" />
        اگر Wi‑Fi ساعت مدام قطع می‌شود، بلوتوث ساعت را موقتاً خاموش کنید تا ساعت روی Wi‑Fi بماند.
      </div>
      <Footer onBack={onBack}>
        <Button onClick={onNext} variant={all ? "primary" : "tonal"} icon={<ArrowLeft className="size-4" />}>
          {all ? "بعدی" : "انجام دادم"}
        </Button>
      </Footer>
    </>
  );
}

/* ---------------------------------- pair ---------------------------------- */

function CodeInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: () => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (raw: string, from: number) => {
    const digits = raw.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, "");
    const chars = value.padEnd(6, " ").split("");
    digits.split("").forEach((d, k) => from + k < 6 && (chars[from + k] = d));
    const next = chars.join("").replace(/\s+$/, "");
    onChange(next);
    const focus = Math.min(5, from + digits.length);
    refs.current[focus]?.focus();
    if (next.replace(/\s/g, "").length === 6) setTimeout(onComplete, 50);
  };

  return (
    <div dir="ltr" className="flex justify-center gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={value[i]?.trim() ?? ""}
          onChange={(e) => set(e.target.value, i)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i]?.trim() && i > 0) {
              const chars = value.split("");
              chars[i - 1] = " ";
              onChange(chars.join("").replace(/\s+$/, ""));
              refs.current[i - 1]?.focus();
              e.preventDefault();
            }
          }}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-14 w-11 rounded-xl border border-line bg-surface text-center text-xl font-semibold tabular-nums outline-none transition",
            "focus:border-primary focus:ring-4 focus:ring-primary/15",
            i === 2 && "me-3",
          )}
        />
      ))}
    </div>
  );
}

function Pair({
  host: initialHost,
  notice,
  onBack,
  onSkip,
  onPaired,
}: {
  host: string;
  notice?: string;
  onBack: () => void;
  onSkip: () => void;
  onPaired: (host: string) => void;
}) {
  const services = useDiscovery(true);
  const [host, setHost] = useState(initialHost);
  const [port, setPort] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const touched = useRef(false);

  const found = services.find((s) => s.type === "pairing" && (!initialHost || s.host === initialHost)) ??
    services.find((s) => s.type === "pairing");

  useEffect(() => {
    if (found && !touched.current) {
      setHost(found.host);
      setPort(String(found.port));
    }
  }, [found?.host, found?.port]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (busy) return;
    setError(undefined);
    if (!host || !port || code.replace(/\s/g, "").length !== 6) {
      setError("IP، پورت و کد ۶ رقمی را کامل وارد کنید.");
      return;
    }
    setBusy(true);
    try {
      await api.pair(host.trim(), Number(port), code.replace(/\s/g, ""));
      onPaired(host.trim());
    } catch (e) {
      setError((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title sub={<>روی ساعت داخل <b className="font-medium text-fg">Wireless debugging</b> گزینهٔ <b className="font-medium text-fg">Pair new device</b> را بزنید و صفحه را باز نگه دارید.</>}>
        جفت‌سازی با کد
      </Title>

      {notice && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl bg-primary-soft/60 px-4 py-3 text-sm leading-6">
          <RefreshCw className="mt-1 size-4 shrink-0" />
          {notice}
        </div>
      )}

      <div className="mb-5 flex h-9 items-center justify-center text-sm">
        {found ? (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5 text-success"
          >
            <StatusMark status="done" doneColor="var(--success)" size={16} />
            ساعت پیدا شد — IP و پورت خودکار پر شد
          </motion.span>
        ) : (
          <span className="flex items-center gap-2 text-muted">
            <Wifi className="size-4" />
            <TextShimmer>در حال جستجوی ساعت در شبکه…</TextShimmer>
          </span>
        )}
      </div>

      <div className="mb-2 text-center text-[13px] font-medium text-muted">کد جفت‌سازی (Wi‑Fi pairing code)</div>
      <CodeInput value={code} onChange={setCode} onComplete={submit} />

      <div className="mt-6 grid grid-cols-[1fr_7rem] gap-3">
        <Field
          label="آدرس IP"
          ltr
          placeholder="192.168.1.20"
          value={host}
          onChange={(e) => {
            touched.current = true;
            setHost(e.target.value);
          }}
        />
        <Field
          label="پورت"
          ltr
          inputMode="numeric"
          placeholder="37xxx"
          value={port}
          onChange={(e) => {
            touched.current = true;
            setPort(e.target.value.replace(/\D/g, ""));
          }}
        />
      </div>
      <p className="mt-2 text-xs leading-6 text-faint">
        IP و پورت همان چیزی است که زیر کد روی ساعت نوشته شده (مثلاً 192.168.1.20:37099).
      </p>

      <ErrorNote>{error}</ErrorNote>

      <Footer onBack={onBack}>
        <Button variant="ghost" onClick={onSkip} className="px-3">
          قبلاً جفت شده
        </Button>
        <Button onClick={submit} loading={busy} icon={<ShieldCheck className="size-4" />}>
          جفت‌سازی
        </Button>
      </Footer>
    </>
  );
}

/* --------------------------------- connect -------------------------------- */

function Connect({
  host: initialHost,
  savedPort,
  onBack,
  onNeedPair,
  onConnected,
}: {
  host: string;
  savedPort?: number;
  onBack: () => void;
  onNeedPair: (msg: string) => void;
  onConnected: (serial: string, host: string, port: number) => void;
}) {
  const services = useDiscovery(true);
  const [host, setHost] = useState(initialHost);
  const [port, setPort] = useState(savedPort ? String(savedPort) : "");
  const [phase, setPhase] = useState<"auto" | "manual" | "connecting">("auto");
  const [error, setError] = useState<string>();
  const attempted = useRef(new Set<string>());

  const attempt = useCallback(
    async (h: string, p: number, fromAuto = false) => {
      const key = `${h}:${p}`;
      if (fromAuto && attempted.current.has(key)) return;
      attempted.current.add(key);
      setPhase("connecting");
      setError(undefined);
      try {
        const serial = await api.connect(h, p);
        onConnected(serial, h, p);
      } catch (e) {
        const err = e as ApiError;
        if (err.code === "NOT_PAIRED") {
          onNeedPair("ارتباط جفت‌سازی از بین رفته (مثلاً ساعت ریست یا مجوزها پاک شده). یک‌بار دیگر کد بگیرید.");
          return;
        }
        setHost(h);
        setPort(String(p));
        setError(err.message);
        setPhase("manual");
      }
    },
    [onConnected, onNeedPair],
  );

  // Auto: adb may already be connected (it auto-connects paired devices via mDNS),
  // otherwise use the advertised connect port, then the last known port.
  useEffect(() => {
    if (phase !== "auto") return;
    let alive = true;
    api
      .devices()
      .then((devs) => {
        const ready = devs.find(
          (d) => d.state === "device" && d.wireless && (!initialHost || d.serial.startsWith(initialHost) || d.serial.includes("_adb-tls-connect")),
        );
        if (alive && ready) onConnected(ready.serial, initialHost || ready.serial.split(":")[0], Number(ready.serial.split(":")[1]) || 0);
      })
      .catch(() => {});
    const svc = services.find((s) => s.type === "connect" && (!initialHost || s.host === initialHost));
    if (svc) attempt(svc.host, svc.port, true);
    return () => {
      alive = false;
    };
  }, [services, phase, initialHost, attempt, onConnected]);

  useEffect(() => {
    if (phase !== "auto") return;
    const t = setTimeout(() => {
      if (savedPort && initialHost) attempt(initialHost, savedPort, true);
      else setPhase("manual");
    }, 4500);
    return () => clearTimeout(t);
  }, [phase, savedPort, initialHost, attempt]);

  const busy = phase !== "manual";

  return (
    <>
      <WatchHero searching={busy} icon={<Wifi />} />
      <Title
        sub={
          busy ? undefined : (
            <>
              آدرس روی ساعت در <b className="font-medium text-fg">Wireless debugging ← IP address &amp; Port</b> نوشته شده.
              این پورت با پورت جفت‌سازی فرق دارد.
            </>
          )
        }
      >
        {busy ? "در حال اتصال به ساعت" : "آدرس اتصال"}
      </Title>

      {busy ? (
        <div className="flex justify-center pb-2 text-sm text-muted">
          <ReasoningText
            phrases={["جستجو در شبکه", "پیدا کردن پورت اتصال", "دست دادن امن با ساعت"]}
            variant="cascade"
            interval={1800}
          />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (host && port) attempt(host.trim(), Number(port));
          }}
        >
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="آدرس IP" ltr placeholder="192.168.1.20" value={host} onChange={(e) => setHost(e.target.value)} />
            <Field
              label="پورت"
              ltr
              inputMode="numeric"
              placeholder="4xxxx"
              autoFocus
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <ErrorNote>{error}</ErrorNote>
          <Footer onBack={onBack}>
            <Button type="button" variant="ghost" className="px-3" onClick={() => onNeedPair("کد تازه‌ای از Pair new device بگیرید.")}>
              جفت‌سازی دوباره
            </Button>
            <Button type="submit" disabled={!host || !port} icon={<Link2 className="size-4" />}>
              اتصال
            </Button>
          </Footer>
        </form>
      )}
      {busy && (
        <div className="mt-6 text-center">
          <button className="text-sm text-primary hover:underline" onClick={() => setPhase("manual")}>
            وارد کردن دستی آدرس
          </button>
        </div>
      )}
    </>
  );
}

/* ---------------------------------- done ---------------------------------- */

function Done({ onContinue }: { onContinue: () => void }) {
  useEffect(() => {
    const t = setTimeout(onContinue, 1400);
    return () => clearTimeout(t);
  }, [onContinue]);
  return (
    <div className="py-6 text-center">
      <div className="mb-5 flex justify-center">
        <StatusMark status="done" doneColor="var(--success)" size={72} strokeWidth={1.6} />
      </div>
      <h1 className="text-xl font-semibold">وصل شدیم!</h1>
      <p className="mt-2 text-sm text-muted">در حال باز کردن فایل‌های ساعت…</p>
    </div>
  );
}

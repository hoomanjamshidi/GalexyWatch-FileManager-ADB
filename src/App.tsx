import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { TextShimmer } from "@/components/loading-states";
import { Drive } from "@/drive/Drive";
import { api, onDeviceLost } from "@/lib/api";
import { loadSaved, saveWatch } from "@/lib/saved";
import { ConnectWizard } from "@/wizard/ConnectWizard";

type Phase = { name: "checking" } | { name: "wizard"; notice?: string } | { name: "drive"; serial: string };

const LOST = "ساعت در دسترس نیست — احتمالاً از Wi‑Fi جدا شده، خوابیده یا Wireless debugging خاموش شده. ساعت را بیدار کنید و دوباره وصل شوید.";

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: "checking" });

  // Resume an existing adb connection on load.
  useEffect(() => {
    api
      .devices()
      .then((devs) => {
        const saved = loadSaved();
        const ready = devs.filter((d) => d.state === "device");
        const pick =
          ready.find((d) => d.serial === saved?.serial) ??
          ready.find((d) => saved?.host && d.serial.startsWith(saved.host)) ??
          (ready.length === 1 ? ready[0] : undefined);
        if (!pick) return setPhase({ name: "wizard" });
        const m = pick.serial.match(/^([\d.]+):(\d+)$/);
        if (m) saveWatch({ host: m[1], port: Number(m[2]), serial: pick.serial });
        setPhase({ name: "drive", serial: pick.serial });
      })
      .catch((e) => setPhase({ name: "wizard", notice: (e as Error).message }));
  }, []);

  // Watch the connection while browsing.
  const serial = phase.name === "drive" ? phase.serial : null;
  useEffect(() => {
    if (!serial) return;
    const lost = () => setPhase({ name: "wizard", notice: LOST });
    const off = onDeviceLost(lost);
    const id = setInterval(() => {
      api
        .devices()
        .then((devs) => {
          if (!devs.some((d) => d.serial === serial && d.state === "device")) lost();
        })
        .catch(() => {});
    }, 4000);
    return () => {
      off();
      clearInterval(id);
    };
  }, [serial]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase.name}
        className="h-full"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {phase.name === "checking" && (
          <div className="grid h-full place-items-center text-muted">
            <TextShimmer>در حال بررسی اتصال…</TextShimmer>
          </div>
        )}
        {phase.name === "wizard" && (
          <ConnectWizard notice={phase.notice} onConnected={(s) => setPhase({ name: "drive", serial: s })} />
        )}
        {phase.name === "drive" && (
          <Drive
            serial={phase.serial}
            onDisconnect={async () => {
              await api.disconnect(phase.serial).catch(() => {});
              setPhase({ name: "wizard" });
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

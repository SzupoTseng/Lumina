// StatusBar — Web (:3000) + Bridge (:3030) status dots at top-centre.
// Polls every 5s. Click a down service to confirm restart via API.
// Bridge stays down ≥ 3 min → confirm() reminder, repeats every 3 min.

import { useEffect, useRef, useState, useCallback } from "react";
import { useT } from "@/features/i18n/i18n";

const REMINDER_INTERVAL_MS = 3 * 60 * 1000;

type Status = "up" | "down" | "checking";

function Dot({ status }: { status: Status }) {
  const color =
    status === "up"   ? "bg-green-400 shadow-[0_0_6px_#4ade80]" :
    status === "down" ? "bg-red-500  shadow-[0_0_6px_#ef4444]"  :
                        "bg-yellow-400 animate-pulse";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function ServicePill({
  label, status, onClick,
}: {
  label: string; status: Status; onClick?: () => void;
}) {
  const extra = status === "down" ? "cursor-pointer opacity-90 hover:opacity-100" : "";
  return (
    <button
      type="button"
      onClick={status === "down" ? onClick : undefined}
      title={status === "down" ? `Click to restart ${label}` : label}
      className={`flex items-center gap-1.5 text-[11px] font-mono bg-transparent border-0 p-0 text-white ${extra}`}
    >
      <Dot status={status} />
      {label}
    </button>
  );
}

export function StatusBar() {
  const t = useT();
  const [web,    setWeb]    = useState<Status>("checking");
  const [bridge, setBridge] = useState<Status>("checking");

  const downSinceRef = useRef<number | null>(null);
  const lastReminderRef = useRef<number | null>(null);
  const reminderActiveRef = useRef(false);

  const doRestart = useCallback(async () => {
    try {
      await fetch("/api/restart-bridge", { method: "POST" });
      await new Promise(r => setTimeout(r, 3000));
    } catch {
      alert(t("ui.bridge.restart.fail"));
    }
  }, [t]);

  const restartBridge = useCallback(async () => {
    if (!confirm(t("ui.bridge.restart.confirm"))) return;
    await doRestart();
  }, [t, doRestart]);

  const check = useCallback(async () => {
    setWeb("up"); // page is loaded → web is up

    let isUp = false;
    try {
      const r = await fetch("http://127.0.0.1:3030/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      const j = await r.json();
      isUp = j.ok === true;
    } catch {
      isUp = false;
    }
    setBridge(isUp ? "up" : "down");

    const now = Date.now();
    if (isUp) {
      downSinceRef.current = null;
      lastReminderRef.current = null;
      return;
    }
    if (downSinceRef.current === null) downSinceRef.current = now;
    const downForMs = now - downSinceRef.current;
    const sinceLast = now - (lastReminderRef.current ?? downSinceRef.current);
    if (downForMs >= REMINDER_INTERVAL_MS && sinceLast >= REMINDER_INTERVAL_MS) {
      if (reminderActiveRef.current) return; // don't stack confirms
      reminderActiveRef.current = true;
      lastReminderRef.current = now;
      const minutes = Math.max(1, Math.floor(downForMs / 60000));
      const msg = `${t("ui.bridge.reminder.prefix")}${minutes}${t("ui.bridge.reminder.suffix")}`;
      const accepted = confirm(msg);
      reminderActiveRef.current = false;
      if (accepted) await doRestart();
    }
  }, [t, doRestart]);

  useEffect(() => {
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [check]);

  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-4 py-1.5 rounded-full border"
      style={{ backgroundColor: "#514062", borderColor: "#856292", color: "white" }}
    >
      <ServicePill label="Web :3000" status={web} />
      <span className="text-white/30 text-xs px-2">|</span>
      <ServicePill label="Bridge :3030" status={bridge} onClick={restartBridge} />
    </div>
  );
}

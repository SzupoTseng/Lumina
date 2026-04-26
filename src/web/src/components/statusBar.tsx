// StatusBar — Web (:3000) + Bridge (:3030) status dots at top-centre.
// Polls every 5s. Click a down service to confirm restart via API.

import { useEffect, useState, useCallback } from "react";

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

async function restartBridge() {
  if (!confirm("Bridge 已停止。重新啟動？")) return;
  try {
    // POST to Next.js API route that shells out to start-bridge.sh
    await fetch("/api/restart-bridge", { method: "POST" });
    // Give it 3s to come up
    await new Promise(r => setTimeout(r, 3000));
  } catch {
    alert("重啟指令送出失敗，請手動執行 scripts/start-bridge.sh");
  }
}

export function StatusBar() {
  const [web,    setWeb]    = useState<Status>("checking");
  const [bridge, setBridge] = useState<Status>("checking");

  const check = useCallback(async () => {
    setWeb("up"); // page is loaded → web is up

    try {
      const r = await fetch("http://127.0.0.1:3030/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      const j = await r.json();
      setBridge(j.ok === true ? "up" : "down");
    } catch {
      setBridge("down");
    }
  }, []);

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

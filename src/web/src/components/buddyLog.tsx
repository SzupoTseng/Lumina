// BuddyLog — records every message shown on the VRM bubble.
// Collects: hook events, demo panel sends, agent monitor alerts.
// Persistent in localStorage; user can clear.

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/features/i18n/i18n";

export interface BuddyLogEntry {
  ts:   number;   // Unix ms
  text: string;
}

const STORAGE_KEY = "lumina.buddyLog";
const MAX_ENTRIES = 200;

function load(): BuddyLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BuddyLogEntry[];
  } catch {}
  return [];
}

function save(entries: BuddyLogEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
}

// Exported hook — call once in index.tsx
export function useBuddyLog() {
  const [entries, setEntries] = useState<BuddyLogEntry[]>([]);

  useEffect(() => { setEntries(load()); }, []);

  const append = useCallback((text: string) => {
    if (!text?.trim()) return;
    setEntries(prev => {
      const next = [...prev, { ts: Date.now(), text }].slice(-MAX_ENTRIES);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return { entries, append, clear };
}

// Panel component
interface Props {
  entries: BuddyLogEntry[];
  onClear: () => void;
}

function fmt(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}`;
}

const PANEL_STYLE = { backgroundColor: "#514062", borderColor: "#856292" } as const;
const OPEN_KEY = "lumina.buddyLog.open";

export function BuddyLogPanel({ entries, onClear }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(localStorage.getItem(OPEN_KEY) === "1"); }, []);

  const toggle = () => setOpen(o => {
    const next = !o;
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    return next;
  });

  // Auto-scroll to latest
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, open]);

  return (
    <div className="absolute top-14 right-4 z-50 flex flex-col items-end gap-1">
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggle}
        style={PANEL_STYLE}
        className="px-3 py-1.5 rounded-xl border-2 text-white text-[11px] font-bold shadow-2xl whitespace-nowrap"
      >
        {open ? "▾" : "▸"} Conversation Log {entries.length > 0 ? `(${entries.length})` : ""}
      </button>

      {/* Log panel */}
      {open && (
        <div
          style={PANEL_STYLE}
          className="w-[260px] max-h-[60vh] rounded-xl border-2 shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/20">
            <span className="text-[10px] text-white/70 uppercase tracking-widest font-bold">
              Buddy Log
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-[9px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white"
            >
              {t("log.clear")}
            </button>
          </div>

          {/* Entries */}
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <p className="text-[10px] text-white/40 p-3 text-center">{t("log.empty")}</p>
            ) : (
              entries.map((e, i) => (
                <div key={i} className="px-3 py-1.5 border-b border-white/10 last:border-0">
                  <span className="text-[9px] text-white/40 mr-2">{fmt(e.ts)}</span>
                  <span className="text-[11px] text-white">{e.text}</span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}

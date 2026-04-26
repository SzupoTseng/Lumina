// SettingsPanel — single collapsible top-right overlay holding all
// Lumina-scope user controls: Buddy (model), Persona (personality),
// Power (eco/balanced/ultra), Language (zh-TW/en/ja).
//
// Deliberately does NOT include API key fields — ChatVRM's existing
// upstream Menu (gear icon, top-right of its own UI) handles those.
// Duplicating would split the source of truth.
//
// Position: fixed top-right, glassmorphic background, collapsible to a
// single chevron icon to free up screen real estate.

import { useEffect, useState, useCallback, useRef } from "react";
import type { BuddyLogEntry } from "@/components/buddyLog";
import { ModelSelector } from "@/components/modelSelector";
import { PersonalitySelector, type Personality } from "@/components/personalitySelector";
import { PowerModeSelector } from "@/components/powerModeSelector";
import { useT, useLocale, ALL_LOCALES, type Locale } from "@/features/i18n/i18n";
import type { PowerMode } from "@/features/powerMode/powerMode";

const COLLAPSED_KEY = "lumina.settingsPanel.collapsed";

function LanguageSelector() {
  const t = useT();
  const [locale, setLocale] = useLocale();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="lumina-language-selector"
        className="text-[10px] text-white/90 uppercase tracking-widest font-bold drop-shadow"
      >
        {t("settings.language")}
      </label>
      <select
        id="lumina-language-selector"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label="Select interface language"
        className="bg-primary text-white px-3 py-2 rounded-md border border-primary-hover text-sm cursor-pointer hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {ALL_LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(`language.${l}` as any)}
          </option>
        ))}
      </select>
    </div>
  );
}

function HookStatus() {
  const t = useT();
  const [status, setStatus] = useState<{ installed: boolean; count: number; expected: number } | null>(null);
  const [busy,   setBusy]   = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/hooks");
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const act = async (action: "install" | "uninstall") => {
    setBusy(true);
    try {
      await fetch("/api/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await refresh();
    } finally { setBusy(false); }
  };

  if (!status) return null;
  const ok = status.installed && status.count >= status.expected;

  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-white/20">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-400" : "bg-red-400"}`} />
        <span className="text-[10px] text-white/80">
          {ok
            ? `${t("hooks.status.ok")} (${status.count})`
            : `${t("hooks.status.missing")} (${status.count}/${status.expected})`}
        </span>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => act("install")}
          disabled={busy}
          className="text-[9px] px-2 py-0.5 rounded bg-primary hover:bg-primary-hover text-white disabled:opacity-40"
        >
          {busy ? t("hooks.installing") : t("hooks.install")}
        </button>
        <button
          onClick={() => act("uninstall")}
          disabled={busy}
          className="text-[9px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-40"
        >
          {t("hooks.uninstall")}
        </button>
      </div>
    </div>
  );
}

function BuddyLogSection({ entries, onClear }: { entries: BuddyLogEntry[]; onClear: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [entries, open]);

  const fmt = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}`;
  };

  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-white/20">
      <div className="flex items-center gap-1.5">
        <button onClick={() => setOpen(o => !o)}
          className="text-[10px] text-white/80 uppercase tracking-widest font-bold flex-1 text-left">
          {open ? "▾" : "▸"} {t("log.title")} {entries.length > 0 ? `(${entries.length})` : ""}
        </button>
        <button onClick={onClear}
          className="text-[9px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white">
          {t("log.clear")}
        </button>
      </div>
      {open && (
        <div className="max-h-[160px] overflow-y-auto rounded-md bg-black/30">
          {entries.length === 0
            ? <p className="text-[10px] text-white/40 p-2 text-center">{t("log.empty")}</p>
            : entries.map((e, i) => (
              <div key={i} className="px-2 py-1 border-b border-white/10 last:border-0">
                <span className="text-[9px] text-white/40 mr-1">{fmt(e.ts)}</span>
                <span className="text-[10px] text-white">{e.text}</span>
              </div>
            ))
          }
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({
  onPersonalityChange,
  onPowerModeChange,
  buddyLogEntries,
  onClearBuddyLog,
}: {
  onPersonalityChange: (p: Personality | null) => void;
  onPowerModeChange: (mode: PowerMode) => void;
  buddyLogEntries: BuddyLogEntry[];
  onClearBuddyLog: () => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Read persisted state after hydration to avoid SSR mismatch
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSED_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div
      style={{ backgroundColor: '#514062', borderColor: '#856292' }}
      className={
        "absolute top-4 right-4 z-50 " +
        "flex flex-col gap-3 text-white " +
        "rounded-xl border-2 shadow-2xl " +
        "transition-all duration-200 " +
        (collapsed ? "p-2" : "p-4 min-w-[200px]")
      }
      role="region"
      aria-label={t("settings.title")}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={t("settings.toggle")}
          suppressHydrationWarning
          className="text-white hover:text-white/80 text-sm leading-none p-1 rounded hover:bg-purple-500/10 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-colors"
        >
          <span suppressHydrationWarning>{collapsed ? "▸" : "▾"}</span>
        </button>
        <span className="text-xs uppercase tracking-widest font-bold text-white flex-1">
          {t("settings.title")}
        </span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          title={t("ui.refresh")}
          className="text-white hover:text-white/80 text-xs leading-none p-1 rounded hover:bg-purple-500/10 focus:outline-none transition-colors"
        >
          ↺
        </button>
      </div>

      {collapsed ? null : (
        <>
          <ModelSelector />
          <PersonalitySelector onPersonalityChange={onPersonalityChange} />
          <PowerModeSelector onChange={onPowerModeChange} />
          <LanguageSelector />
          <HookStatus />
          <BuddyLogSection entries={buddyLogEntries} onClear={onClearBuddyLog} />
        </>
      )}
    </div>
  );
}

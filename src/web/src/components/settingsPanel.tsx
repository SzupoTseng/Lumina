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

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from "react";
import type { BuddyLogEntry } from "@/components/buddyLog";
import { ModelSelector } from "@/components/modelSelector";
import { PersonalitySelector, type Personality } from "@/components/personalitySelector";
import { PowerModeSelector } from "@/components/powerModeSelector";
import { useT, useLocale, ALL_LOCALES, type Locale } from "@/features/i18n/i18n";
import type { PowerMode } from "@/features/powerMode/powerMode";
import {
  loadSettings,
  saveSettings,
  resetSettings,
  subscribeSettings,
  DEFAULT_SETTINGS,
  BUBBLE_DURATION_RANGE,
  type LuminaSettings,
} from "@/features/luminaSettings/luminaSettings";
import { agentDisplayName, DEFAULT_AGENT, type AgentId } from "@/features/agents/agents";

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

type HookConfigResponse = {
  agent: AgentId;
  path: string;
  exists: boolean;
  content: string | null;
  parsed: unknown;
  codexFeatureEnabled: boolean | null;
};

// HookSection — the outer wrapper that composes the two pieces below.
// Kept as a thin shell so a future contributor can reorder/remove either
// child without touching the SettingsPanel composition.
function HookSection({ agent }: { agent: AgentId }) {
  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-white/20">
      <HookInstallControls agent={agent} />
      <HookConfigViewer    agent={agent} />
    </div>
  );
}

// Install/uninstall buttons + status badge. Wraps the legacy /api/hooks
// route, which is claude-only — for codex/copilot the launcher's
// install-hooks.{sh,ps1} already does the work, so this component renders
// nothing for those agents.
function HookInstallControls({ agent }: { agent: AgentId }) {
  const t = useT();
  const [status, setStatus] = useState<{ installed: boolean; count: number; expected: number } | null>(null);
  const [busy,   setBusy]   = useState(false);

  const refresh = useCallback(async () => {
    if (agent !== "claude") { setStatus(null); return; }
    try {
      const r = await fetch("/api/hooks");
      if (r.ok) setStatus(await r.json());
    } catch { /* network/api down — leave status null */ }
  }, [agent]);

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

  if (agent !== "claude" || status == null) return null;
  const ok = status.installed && status.count >= status.expected;

  return (
    <>
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
    </>
  );
}

// Agent-aware JSON viewer for the hook config file. Works for all 3 agents.
// Toggle to show, refresh button to re-fetch, copy-path for clipboard.
function HookConfigViewer({ agent }: { agent: AgentId }) {
  const t = useT();
  const [viewer, setViewer] = useState<HookConfigResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Tracks the in-flight fetch so a fast agent-switch can cancel a slow
  // earlier request — otherwise the slow request would resolve last and
  // overwrite the newer agent's viewer state with stale data.
  const inFlightRef = useRef<AbortController | null>(null);

  const fetchViewer = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    try {
      const r = await fetch(
        `/api/hooks/config?agent=${encodeURIComponent(agent)}`,
        { signal: controller.signal },
      );
      if (r.ok) setViewer(await r.json());
    } catch (e) {
      // AbortError is expected when a new request supersedes this one;
      // ignore silently. Other errors leave the previous viewer state intact.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        // Real network error — keep the old viewer; user can hit refresh.
      }
    } finally {
      // Only clear loading if THIS request is still the in-flight one
      // (otherwise a newer fetch is owning the spinner state).
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
        setLoading(false);
      }
    }
  }, [agent]);

  // Re-fetch when the viewer is opened, or when the agent changes while
  // open (e.g. a different tab fired an event from another agent).
  // Cleanup also aborts any in-flight request when the viewer is closed
  // or the component unmounts.
  useEffect(() => {
    if (open) fetchViewer();
    return () => { inFlightRef.current?.abort(); };
  }, [open, fetchViewer]);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-white/60 uppercase tracking-widest">
          {agentDisplayName(agent)}
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[9px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white ml-auto"
        >
          {open ? t("hooks.hideJson") : t("hooks.viewJson")}
        </button>
      </div>

      {open && (
        <div className="rounded-md bg-black/40 p-2 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-white/60 flex-1">
              {t("hooks.config.title")}
            </span>
            <button
              onClick={fetchViewer}
              disabled={loading}
              title={t("ui.refresh")}
              className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-40"
            >
              ↻
            </button>
            {viewer?.path && (
              <CopyPathButton path={viewer.path} label={t("hooks.copyPath")} doneLabel={t("hooks.copied")} />
            )}
          </div>
          {loading && <div className="text-[10px] text-white/40">…</div>}
          {!loading && viewer && (
            <>
              <div className="text-[9px] text-white/50 break-all font-mono leading-snug">
                {viewer.path}
              </div>
              {viewer.codexFeatureEnabled === false && (
                <div className="text-[10px] text-amber-300 leading-snug">
                  {t("hooks.config.codexFlagOff")}
                </div>
              )}
              {viewer.exists ? (
                <pre className="max-h-[240px] overflow-auto text-[9px] text-white/80 font-mono leading-snug whitespace-pre">
                  {viewer.content}
                </pre>
              ) : (
                <div className="text-[10px] text-white/50">{t("hooks.config.missing")}</div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

function CopyPathButton({ path: p, label, doneLabel }: { path: string; label: string; doneLabel: string }) {
  const [done, setDone] = useState(false);
  const onClick = useCallback(async () => {
    try {
      // Modern clipboard path; falls back to a hidden textarea trick if
      // the browser refuses the navigator.clipboard call (e.g. insecure
      // origin in some embedded WebViews).
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(p);
      } else {
        const ta = document.createElement("textarea");
        ta.value = p; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove();
      }
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      // ignore — best-effort
    }
  }, [p]);
  return (
    <button
      onClick={onClick}
      title={label}
      className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white"
    >
      {done ? doneLabel : "📋"}
    </button>
  );
}

function useLuminaSettings(): LuminaSettings {
  return useSyncExternalStore(
    subscribeSettings,
    loadSettings,
    () => DEFAULT_SETTINGS,
  );
}

function AdvancedSection() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const settings = useLuminaSettings();

  const update = (patch: Partial<LuminaSettings>) => {
    saveSettings({ ...settings, ...patch });
  };

  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-white/20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] text-white/80 uppercase tracking-widest font-bold text-left"
      >
        {open ? "▾" : "▸"} {t("settings.advanced")}
      </button>

      {open && (
        <div className="flex flex-col gap-2 pt-1">
          {/* Bubble duration slider */}
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-white/80">
              {t("settings.bubbleDuration")} — {(settings.bubbleDurationMs / 1000).toFixed(1)}s
            </span>
            <input
              type="range"
              min={BUBBLE_DURATION_RANGE[0]}
              max={BUBBLE_DURATION_RANGE[1]}
              step={250}
              value={settings.bubbleDurationMs}
              onChange={(e) => update({ bubbleDurationMs: Number(e.target.value) })}
              className="accent-purple-400"
            />
          </label>

          {/* Memory stream toggle */}
          <ToggleRow
            label={t("settings.memoryStream")}
            value={settings.memoryStreamEnabled}
            onLabel={t("ui.on")}
            offLabel={t("ui.off")}
            onChange={(v) => update({ memoryStreamEnabled: v })}
          />

          {/* Achievement toasts toggle */}
          <ToggleRow
            label={t("settings.achievements")}
            value={settings.achievementToastsEnabled}
            onLabel={t("ui.on")}
            offLabel={t("ui.off")}
            onChange={(v) => update({ achievementToastsEnabled: v })}
          />

          <button
            onClick={() => {
              if (window.confirm(t("settings.resetConfirm"))) resetSettings();
            }}
            className="self-start text-[9px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white mt-1"
          >
            {t("settings.reset")}
          </button>
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label, value, onLabel, offLabel, onChange,
}: {
  label: string; value: boolean;
  onLabel: string; offLabel: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/80 flex-1">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={
          "text-[9px] px-2 py-0.5 rounded text-white " +
          (value ? "bg-primary hover:bg-primary-hover" : "bg-white/10 hover:bg-white/20")
        }
      >
        {value ? onLabel : offLabel}
      </button>
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
  agent = DEFAULT_AGENT,
}: {
  onPersonalityChange: (p: Personality | null) => void;
  onPowerModeChange: (mode: PowerMode) => void;
  buddyLogEntries: BuddyLogEntry[];
  onClearBuddyLog: () => void;
  agent?: AgentId;
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
        // Cap height at viewport-minus-margins; scroll the inner content
        // when expanded sections (Advanced + JSON viewer + log) overflow.
        // Without this the panel pushes itself off-screen at low res.
        "max-h-[calc(100vh-32px)] overflow-y-auto " +
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
          <HookSection agent={agent} />
          <AdvancedSection />
          <BuddyLogSection entries={buddyLogEntries} onClear={onClearBuddyLog} />
        </>
      )}
    </div>
  );
}

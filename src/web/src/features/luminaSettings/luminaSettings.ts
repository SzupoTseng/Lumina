// luminaSettings — user-tunable Lumina-specific knobs that don't deserve
// dedicated feature modules. Mirrors the powerMode pattern: pure
// load/save against localStorage, plus a useSyncExternalStore subscriber
// for cross-tab + same-tab live updates without React state.
//
// Add a new knob: extend Settings + DEFAULT_SETTINGS + the
// loadSettings/normalize block, then surface in components/settingsPanel.tsx.
//
// All knobs are intentionally optional with sensible defaults — a fresh
// localStorage on a new browser shouldn't change visible behavior.

const STORAGE_KEY = "lumina.settings";

export type LuminaSettings = {
  // How long the speech bubble stays before auto-clearing. ms.
  // Range UI clamps to [1500, 8000]; old saved values outside that range
  // are clamped on read to keep things sane.
  bubbleDurationMs: number;

  // Memory stream — captures positive events (test passes, achievements,
  // git pushes) and surfaces a 1-line reminiscence at SessionStart.
  // Off = no recording, no recall.
  memoryStreamEnabled: boolean;

  // Achievement toasts — small gold popup when an achievement unlocks.
  // Off = unlock still recorded silently, no popup.
  achievementToastsEnabled: boolean;
};

export const DEFAULT_SETTINGS: LuminaSettings = {
  bubbleDurationMs: 4000,
  memoryStreamEnabled: true,
  achievementToastsEnabled: true,
};

const BUBBLE_MIN = 1500;
const BUBBLE_MAX = 8000;

function normalize(raw: Partial<LuminaSettings> | null | undefined): LuminaSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const out: LuminaSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw.bubbleDurationMs === "number" && Number.isFinite(raw.bubbleDurationMs)) {
    out.bubbleDurationMs = Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, Math.round(raw.bubbleDurationMs)));
  }
  if (typeof raw.memoryStreamEnabled === "boolean") {
    out.memoryStreamEnabled = raw.memoryStreamEnabled;
  }
  if (typeof raw.achievementToastsEnabled === "boolean") {
    out.achievementToastsEnabled = raw.achievementToastsEnabled;
  }
  return out;
}

// Module-level cached snapshot. useSyncExternalStore's getSnapshot must
// return a *referentially stable* value when nothing has changed — otherwise
// React re-renders, which calls getSnapshot again, which returns yet another
// fresh object, and we loop forever ("Maximum update depth exceeded").
//
// The cache is invalidated only inside save/reset/subscribe-event paths so
// React only re-renders when the storage actually changed.
let cachedSnapshot: LuminaSettings | null = null;

function readFromStorage(): LuminaSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Public read API. Returns the cached snapshot (stable reference) — useful
// for both useSyncExternalStore and ref-based consumers.
export function loadSettings(): LuminaSettings {
  if (cachedSnapshot === null) cachedSnapshot = readFromStorage();
  return cachedSnapshot;
}

export function saveSettings(s: LuminaSettings): void {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalize(s);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    // Refresh cache before notifying so listeners (which immediately re-read)
    // see the new value on their first call.
    cachedSnapshot = normalized;
    window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT));
  } catch {
    // ignore — storage may be quota-full or disabled in private mode
  }
}

export function resetSettings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    cachedSnapshot = { ...DEFAULT_SETTINGS };
    window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT));
  } catch { /* noop */ }
}

// useSyncExternalStore plumbing so components can subscribe without adding
// React state to every consumer (and stay in sync across tabs).
const SAME_TAB_EVENT = "lumina:settings-changed";

export function subscribeSettings(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Force-refresh the cache when the storage actually changes — that's the
  // only path where the snapshot reference is allowed to flip.
  const refresh = () => { cachedSnapshot = readFromStorage(); cb(); };
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) refresh(); };
  const onSameTab = () => refresh();
  window.addEventListener("storage", onStorage);
  window.addEventListener(SAME_TAB_EVENT, onSameTab);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SAME_TAB_EVENT, onSameTab);
  };
}

export const BUBBLE_DURATION_RANGE: readonly [number, number] = [BUBBLE_MIN, BUBBLE_MAX];
export const STORAGE_KEY_EXPORT = STORAGE_KEY;

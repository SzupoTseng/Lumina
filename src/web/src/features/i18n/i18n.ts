// i18n — tiny dep-free localization for Lumina's own UI strings.
//
// Scope is deliberately narrow: only Lumina-authored labels, hints, and
// short button text. ChatVRM upstream's own UI strings stay as-is (they
// would be a separate ~50-string translation effort).
//
// Why not react-i18next: at this size (≤30 keys), the library would
// drag in ~50 transitive packages and a backend/loader story we don't
// need. A typed Record<Locale, Record<Key, string>> is honest and small.
//
// Usage in components:
//   const t = useT();
//   <label>{t("settings.power")}</label>
//
// Locale state:
//   - localStorage["lumina.locale"] is the source of truth
//   - storage event syncs across tabs (same pattern as model/personality)
//   - Default = "zh-TW" (the project was written in Traditional Chinese
//     first; English/Japanese are layered on top)

import { useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "lumina.locale";

export type Locale = "zh-TW" | "en" | "ja";
const VALID_LOCALES: ReadonlyArray<Locale> = ["zh-TW", "en", "ja"];

export const DEFAULT_LOCALE: Locale = "zh-TW";

// Translation key registry. Add a key here, then add the string to each
// locale below. Missing translations fall back to the default locale's
// string, then to the key itself if even that's missing.
type Key =
  | "settings.title"
  | "settings.buddy"
  | "settings.persona"
  | "settings.power"
  | "settings.language"
  | "settings.tasks"
  | "settings.toggle"
  | "settings.collapsed"
  | "power.eco"
  | "power.eco.hint"
  | "power.balanced"
  | "power.balanced.hint"
  | "power.ultra"
  | "power.ultra.hint"
  | "language.zh-TW"
  | "language.en"
  | "language.ja"
  | "hooks.status.ok"
  | "hooks.status.missing"
  | "hooks.install"
  | "hooks.uninstall"
  | "hooks.installing"
  | "hooks.viewJson"
  | "hooks.hideJson"
  | "hooks.config.title"
  | "hooks.config.missing"
  | "hooks.config.codexFlagOff"
  | "hooks.copyPath"
  | "hooks.copied"
  | "settings.advanced"
  | "settings.bubbleDuration"
  | "settings.memoryStream"
  | "settings.achievements"
  | "settings.reset"
  | "settings.resetConfirm"
  | "ui.on"
  | "ui.off"
  | "log.title"
  | "log.empty"
  | "log.clear"
  | "ui.refresh"
  | "ui.bridge.restart.confirm"
  | "ui.bridge.restart.fail"
  | "ui.bridge.reminder.prefix"
  | "ui.bridge.reminder.suffix"
  | "demo.title"
  | "demo.cat.slash"
  | "demo.cat.emotion"
  | "demo.cat.git"
  | "demo.cat.lang"
  | "demo.cat.result"
  | "demo.cat.session"
  | "demo.send";

const STRINGS: Record<Locale, Record<Key, string>> = {
  "zh-TW": {
    "settings.title": "設定",
    "settings.buddy": "角色",
    "settings.persona": "人格",
    "settings.power": "效能",
    "settings.language": "語言",
    "settings.tasks": "任務",
    "settings.toggle": "開關面板",
    "settings.collapsed": "Lumina",
    "power.eco": "Eco",
    "power.eco.hint": "節能：泡泡為主，無特效",
    "power.balanced": "Balanced",
    "power.balanced.hint": "平衡：完整特效（預設）",
    "power.ultra": "Ultra",
    "power.ultra.hint": "全開：粒子加倍、時長延長",
    "language.zh-TW": "繁體中文",
    "language.en": "English",
    "language.ja": "日本語",
    "hooks.status.ok": "Hooks ✓",
    "hooks.status.missing": "Hooks 未安裝",
    "hooks.install": "安裝",
    "hooks.uninstall": "移除",
    "hooks.installing": "…",
    "hooks.viewJson": "看 JSON",
    "hooks.hideJson": "收起",
    "hooks.config.title": "Hook 設定",
    "hooks.config.missing": "（檔案不存在 — 此 agent CLI 可能未安裝）",
    "hooks.config.codexFlagOff": "⚠️ ~/.codex/config.toml 缺少 [features] codex_hooks=true，hook 不會觸發",
    "hooks.copyPath": "複製路徑",
    "hooks.copied": "✓",
    "settings.advanced": "進階設定",
    "settings.bubbleDuration": "對話泡泡持續時間",
    "settings.memoryStream": "記憶流",
    "settings.achievements": "成就通知",
    "settings.reset": "重設",
    "settings.resetConfirm": "確定要重設所有 Lumina 設定嗎？",
    "ui.on": "開",
    "ui.off": "關",
    "log.title": "Buddy Log",
    "log.empty": "尚無紀錄",
    "log.clear": "清除",
    "ui.refresh": "重新整理",
    "ui.bridge.restart.confirm": "Bridge 已停止。重新啟動？",
    "ui.bridge.restart.fail": "Bridge 重啟失敗，請手動執行 scripts/start-bridge.sh",
    "ui.bridge.reminder.prefix": "Bridge 已斷線 ",
    "ui.bridge.reminder.suffix": " 分鐘，請檢查連線。要立即重啟嗎？",
    "demo.title": "互動測試",
    "demo.cat.slash": "Slash Commands",
    "demo.cat.emotion": "情緒測試",
    "demo.cat.git": "Git 操作",
    "demo.cat.lang": "程式語言",
    "demo.cat.result": "測試結果",
    "demo.cat.session": "Session 事件",
    "demo.send": "送出",
  },
  en: {
    "settings.title": "Settings",
    "settings.buddy": "Buddy",
    "settings.persona": "Persona",
    "settings.power": "Power",
    "settings.language": "Language",
    "settings.tasks": "Tasks",
    "settings.toggle": "Toggle panel",
    "settings.collapsed": "Lumina",
    "power.eco": "Eco",
    "power.eco.hint": "Bubble lines only, no overlays",
    "power.balanced": "Balanced",
    "power.balanced.hint": "Full effects (default)",
    "power.ultra": "Ultra",
    "power.ultra.hint": "Doubled particles, longer durations",
    "language.zh-TW": "繁體中文",
    "language.en": "English",
    "language.ja": "日本語",
    "hooks.status.ok": "Hooks ✓",
    "hooks.status.missing": "Hooks not installed",
    "hooks.install": "Install",
    "hooks.uninstall": "Remove",
    "hooks.installing": "…",
    "hooks.viewJson": "View JSON",
    "hooks.hideJson": "Hide",
    "hooks.config.title": "Hook config",
    "hooks.config.missing": "(file not found — agent CLI probably not installed)",
    "hooks.config.codexFlagOff": "⚠️ ~/.codex/config.toml missing [features] codex_hooks=true — hooks won't fire",
    "hooks.copyPath": "Copy path",
    "hooks.copied": "✓",
    "settings.advanced": "Advanced",
    "settings.bubbleDuration": "Bubble duration",
    "settings.memoryStream": "Memory stream",
    "settings.achievements": "Achievement toasts",
    "settings.reset": "Reset",
    "settings.resetConfirm": "Reset all Lumina settings to defaults?",
    "ui.on": "On",
    "ui.off": "Off",
    "log.title": "Buddy Log",
    "log.empty": "No entries yet",
    "log.clear": "Clear",
    "ui.refresh": "Refresh",
    "ui.bridge.restart.confirm": "Bridge is down. Restart it?",
    "ui.bridge.restart.fail": "Failed to restart bridge. Run scripts/start-bridge.sh manually.",
    "ui.bridge.reminder.prefix": "Bridge has been disconnected for ",
    "ui.bridge.reminder.suffix": " minute(s). Please check. Restart now?",
    "demo.title": "Demo",
    "demo.cat.slash": "Slash Commands",
    "demo.cat.emotion": "Emotions",
    "demo.cat.git": "Git Ops",
    "demo.cat.lang": "Languages",
    "demo.cat.result": "Test Results",
    "demo.cat.session": "Session Events",
    "demo.send": "Send",
  },
  ja: {
    "settings.title": "設定",
    "settings.buddy": "バディ",
    "settings.persona": "性格",
    "settings.power": "性能",
    "settings.language": "言語",
    "settings.tasks": "タスク",
    "settings.toggle": "パネル切替",
    "settings.collapsed": "Lumina",
    "power.eco": "Eco",
    "power.eco.hint": "省電力：バブルのみ、エフェクト無し",
    "power.balanced": "Balanced",
    "power.balanced.hint": "標準：フルエフェクト（既定）",
    "power.ultra": "Ultra",
    "power.ultra.hint": "全開：パーティクル倍、時間延長",
    "language.zh-TW": "繁體中文",
    "language.en": "English",
    "language.ja": "日本語",
    "hooks.status.ok": "Hooks ✓",
    "hooks.status.missing": "Hooks 未インストール",
    "hooks.install": "インストール",
    "hooks.uninstall": "削除",
    "hooks.installing": "…",
    "hooks.viewJson": "JSONを見る",
    "hooks.hideJson": "閉じる",
    "hooks.config.title": "Hook 設定",
    "hooks.config.missing": "（ファイルが存在しません — agent CLI 未インストールの可能性）",
    "hooks.config.codexFlagOff": "⚠️ ~/.codex/config.toml に [features] codex_hooks=true がありません — hookが発火しません",
    "hooks.copyPath": "パスをコピー",
    "hooks.copied": "✓",
    "settings.advanced": "詳細設定",
    "settings.bubbleDuration": "吹き出し表示時間",
    "settings.memoryStream": "メモリーストリーム",
    "settings.achievements": "達成通知",
    "settings.reset": "リセット",
    "settings.resetConfirm": "Lumina の設定をすべてリセットしますか？",
    "ui.on": "オン",
    "ui.off": "オフ",
    "log.title": "Buddy Log",
    "log.empty": "記録なし",
    "log.clear": "クリア",
    "ui.refresh": "更新",
    "ui.bridge.restart.confirm": "Bridgeが停止しています。再起動しますか？",
    "ui.bridge.restart.fail": "Bridgeの再起動に失敗しました。scripts/start-bridge.shを手動で実行してください。",
    "ui.bridge.reminder.prefix": "Bridgeが切断されてから ",
    "ui.bridge.reminder.suffix": " 分経過しました。確認してください。今すぐ再起動しますか？",
    "demo.title": "デモ",
    "demo.cat.slash": "スラッシュコマンド",
    "demo.cat.emotion": "感情テスト",
    "demo.cat.git": "Git操作",
    "demo.cat.lang": "言語反応",
    "demo.cat.result": "テスト結果",
    "demo.cat.session": "セッションイベント",
    "demo.send": "送信",
  },
};

// --- Module-level state + subscriber pattern ----------------------------

const listeners = new Set<() => void>();
let currentLocale: Locale = DEFAULT_LOCALE;
let initialized = false;

function readFromStorage(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_LOCALES as ReadonlyArray<string>).includes(raw)) {
      return raw as Locale;
    }
  } catch {}
  return DEFAULT_LOCALE;
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  currentLocale = readFromStorage();
  // Cross-tab sync via storage events.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    if ((VALID_LOCALES as ReadonlyArray<string>).includes(e.newValue)) {
      currentLocale = e.newValue as Locale;
      for (const cb of listeners) cb();
    }
  });
}

export function getLocale(): Locale {
  ensureInitialized();
  return currentLocale;
}

export function setLocale(next: Locale): void {
  ensureInitialized();
  if (currentLocale === next) return;
  currentLocale = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// React-friendly hook. Re-renders on locale change. Returns a t() fn
// pinned to the current locale so consumers don't need useMemo dance.
export function useT(): (key: Key) => string {
  const locale = useSyncExternalStore(
    subscribe,
    getLocale,
    () => DEFAULT_LOCALE, // SSR snapshot
  );
  // Re-bind the lookup whenever the locale changes; lookup is O(1).
  return (key: Key) => {
    return (
      STRINGS[locale][key] ??
      STRINGS[DEFAULT_LOCALE][key] ??
      key
    );
  };
}

export function useLocale(): [Locale, (next: Locale) => void] {
  const locale = useSyncExternalStore(
    subscribe,
    getLocale,
    () => DEFAULT_LOCALE,
  );
  return [locale, setLocale];
}

// SSR-safe initial load (call once from a client effect to ensure the
// pre-render matches the user's stored locale).
export function useHydrateLocale(): void {
  useEffect(() => {
    ensureInitialized();
    const stored = readFromStorage();
    if (stored !== currentLocale) {
      currentLocale = stored;
      for (const cb of listeners) cb();
    }
  }, []);
}

export const ALL_LOCALES = VALID_LOCALES;

// DemoPanel — interactive playground for all Lumina VRM features.
// Left-side collapsible panel; categorised rows with Send buttons.
// Add a new demo item by appending to any DEMOS array below.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT, useLocale, getLocale } from "@/features/i18n/i18n";
import { agentDisplayName, type AgentId } from "@/features/agents/agents";

type EmotionPreset = "neutral" | "happy" | "angry" | "sad" | "relaxed";
type EffectKind    = "energy_gather" | "triumph" | "flash" | "crisis";

interface DemoItem {
  label:     string;
  bubble:    string;       // zh-TW default
  bubble_en?: string;
  bubble_ja?: string;
  emotion:   EmotionPreset;
  effect:    EffectKind;
  duration:  number;
}

interface Category { title: string; items: DemoItem[] }

// ── data ─────────────────────────────────────────────────────────────────────

const SLASH_DEMOS: DemoItem[] = [
  { label:"🔥 /effort",  bubble:"🔥 集中精神中…",    bubble_en:"🔥 Deep focus mode…",      bubble_ja:"🔥 集中中…",      emotion:"happy",   effect:"energy_gather", duration:6000 },
  { label:"🌐 /init",    bubble:"🌐 啟動中…",          bubble_en:"🌐 Initialising…",          bubble_ja:"🌐 起動中…",      emotion:"neutral", effect:"energy_gather", duration:5000 },
  { label:"🔍 /review",  bubble:"🔍 仔細看每一行。",   bubble_en:"🔍 Reviewing every line.",  bubble_ja:"🔍 コードレビュー中。", emotion:"neutral", effect:"triumph",  duration:4000 },
  { label:"🔧 /fix",     bubble:"🔧 重構這段邏輯。",   bubble_en:"🔧 Refactoring the logic.", bubble_ja:"🔧 修正中。",     emotion:"happy",   effect:"triumph",       duration:4000 },
  { label:"💡 /explain", bubble:"💡 來推理一下。",      bubble_en:"💡 Let me reason through.", bubble_ja:"💡 解説します。", emotion:"relaxed", effect:"triumph",       duration:3500 },
  { label:"🎯 /test",    bubble:"🎯 開始跑測試。",      bubble_en:"🎯 Running tests.",         bubble_ja:"🎯 テスト実行。", emotion:"neutral", effect:"flash",         duration:1500 },
  { label:"✨ /clear",   bubble:"✨ 清乾淨。",           bubble_en:"✨ Cleaning up.",           bubble_ja:"✨ クリーン。",   emotion:"happy",   effect:"flash",         duration:1200 },
  { label:"➕ /add",     bubble:"➕ 加進來。",           bubble_en:"➕ Adding it in.",          bubble_ja:"➕ 追加します。", emotion:"happy",   effect:"flash",         duration:1500 },
  { label:"🐛 /bug",     bubble:"🐛 發現異常…",         bubble_en:"🐛 Bug detected…",         bubble_ja:"🐛 バグ検出…",   emotion:"sad",     effect:"crisis",        duration:3200 },
  { label:"🔎 /search",  bubble:"🔎 找找看…",            bubble_en:"🔎 Searching…",             bubble_ja:"🔎 検索中…",     emotion:"neutral", effect:"triumph",       duration:3500 },
  { label:"💥 /delete",  bubble:"💥 移除中…",           bubble_en:"💥 Removing…",             bubble_ja:"💥 削除中…",     emotion:"angry",   effect:"crisis",        duration:3200 },
];

const EMOTION_DEMOS: DemoItem[] = [
  { label:"😊 Happy",   bubble:"😊 開心！",   bubble_en:"😊 Happy!",    bubble_ja:"😊 うれしい！", emotion:"happy",   effect:"flash",  duration:1200 },
  { label:"😢 Sad",     bubble:"😢 難過…",    bubble_en:"😢 Sad…",      bubble_ja:"😢 悲しい…",   emotion:"sad",     effect:"flash",  duration:1200 },
  { label:"😠 Angry",   bubble:"😠 生氣！",   bubble_en:"😠 Angry!",    bubble_ja:"😠 怒った！",   emotion:"angry",   effect:"crisis", duration:1500 },
  { label:"😌 Relaxed", bubble:"😌 放鬆中。", bubble_en:"😌 Relaxed.",  bubble_ja:"😌 リラックス。", emotion:"relaxed", effect:"flash",  duration:1200 },
  { label:"😐 Neutral", bubble:"😐 …",        bubble_en:"😐 …",         bubble_ja:"😐 …",          emotion:"neutral", effect:"flash",  duration:800  },
];

const GIT_DEMOS: DemoItem[] = [
  { label:"🚀 push",     bubble:"🚀 推到雲端了。",    bubble_en:"🚀 Pushed to remote.",      bubble_ja:"🚀 プッシュ完了。",    emotion:"happy",   effect:"triumph", duration:3000 },
  { label:"📝 commit",   bubble:"📝 紀錄存下來了。",  bubble_en:"📝 Commit recorded.",       bubble_ja:"📝 コミット完了。",    emotion:"neutral", effect:"flash",   duration:1200 },
  { label:"🤝 merge",    bubble:"🤝 合好了。",         bubble_en:"🤝 Merged.",                bubble_ja:"🤝 マージ完了。",      emotion:"happy",   effect:"triumph", duration:2500 },
  { label:"😱 conflict", bubble:"😱 Merge conflict！", bubble_en:"😱 Merge conflict!",        bubble_ja:"😱 コンフリクト！",   emotion:"angry",   effect:"crisis",  duration:3200 },
  { label:"↩️ reset",    bubble:"↩️ 退回去了。",       bubble_en:"↩️ Rolled back.",           bubble_ja:"↩️ リセットした。",   emotion:"sad",     effect:"crisis",  duration:2000 },
  { label:"🌿 branch",   bubble:"🌿 分支操作。",       bubble_en:"🌿 Branch operation.",      bubble_ja:"🌿 ブランチ操作。",   emotion:"neutral", effect:"flash",   duration:1000 },
  { label:"📥 pull",     bubble:"📥 拉夥伴的進度…",   bubble_en:"📥 Pulling changes…",       bubble_ja:"📥 プル中…",          emotion:"relaxed", effect:"flash",   duration:1200 },
  { label:"🍒 cherry",   bubble:"🍒 摘 commit。",      bubble_en:"🍒 Cherry-picked.",         bubble_ja:"🍒 チェリーピック。", emotion:"happy",   effect:"flash",   duration:1200 },
];

const LANG_DEMOS: DemoItem[] = [
  { label:"🐍 Python",     bubble:"🐍 Python — 寫起來舒服。",           bubble_en:"🐍 Python — feels good.",        bubble_ja:"🐍 Python — 気持ちいい。",  emotion:"relaxed", effect:"flash", duration:1200 },
  { label:"🦀 Rust",       bubble:"🦀 Rust — borrow checker 開心。",    bubble_en:"🦀 Rust — borrow checker happy.", bubble_ja:"🦀 Rust — 安全！",           emotion:"happy",   effect:"flash", duration:1200 },
  { label:"🔷 TypeScript", bubble:"🔷 TypeScript — 型別護航。",          bubble_en:"🔷 TypeScript — types protect.",  bubble_ja:"🔷 TypeScript — 型安全。",   emotion:"happy",   effect:"flash", duration:1200 },
  { label:"💢 C++",        bubble:"💢 C++ — 小心 pointer…",             bubble_en:"💢 C++ — watch the pointers…",   bubble_ja:"💢 C++ — ポインタ注意…",    emotion:"sad",     effect:"flash", duration:1200 },
  { label:"🐹 Go",         bubble:"🐹 Go — 簡潔。",                      bubble_en:"🐹 Go — clean and simple.",       bubble_ja:"🐹 Go — シンプル。",         emotion:"neutral", effect:"flash", duration:1000 },
  { label:"🗃️ SQL",        bubble:"🗃️ SQL — 別忘了 WHERE。",            bubble_en:"🗃️ SQL — don't forget WHERE.",   bubble_ja:"🗃️ SQL — WHERE忘れずに。",  emotion:"neutral", effect:"flash", duration:1000 },
];

const RESULT_DEMOS: DemoItem[] = [
  { label:"✅ 10+ Tests",  bubble:"🎯 23 個測試全過。一切都在計畫之中。", bubble_en:"🎯 23 tests passed. All according to plan.", bubble_ja:"🎯 23個テスト通過。計画通り。", emotion:"happy",   effect:"triumph", duration:4000 },
  { label:"❌ Test Fail",  bubble:"❌ 3 個測試失敗…",                     bubble_en:"❌ 3 tests failed…",                          bubble_ja:"❌ 3個のテストが失敗…",         emotion:"sad",     effect:"crisis",  duration:2500 },
  { label:"✅ Build OK",   bubble:"✅ 編譯通過。",                         bubble_en:"✅ Build passed.",                             bubble_ja:"✅ ビルド成功。",                emotion:"happy",   effect:"triumph", duration:2500 },
  { label:"🔥 Build Fail", bubble:"🔥 5 個錯。",                           bubble_en:"🔥 5 errors.",                                 bubble_ja:"🔥 5個のエラー。",              emotion:"sad",     effect:"crisis",  duration:3000 },
  { label:"🧹 Lint Clean", bubble:"🧹 整潔。",                             bubble_en:"🧹 Clean.",                                    bubble_ja:"🧹 きれい。",                   emotion:"relaxed", effect:"flash",   duration:1200 },
];

// SESSION_DEMOS is built per agent because lifecycle coverage differs:
//   claude  — fires SessionStart, Stop, Notification, SessionEnd (all 4)
//   codex   — no SessionEnd (Codex CLI doesn't expose that event)
//   copilot — no Stop      (Copilot CLI doesn't expose a turn-finished event)
// PermissionRequest (codex) and errorOccurred (copilot) both map to canonical
// Notification, so the Notification demo fires the same UI on all 3 agents.
// Agent name comes from agentDisplayName(); only the greeting per-locale
// lives here (translation responsibility, not a brand-name table).
const SESSION_GREETING: Record<AgentId, { zh: string; en: string; ja: string }> = {
  claude:  { zh: "👋 Claude 來上班了。",  en: "👋 Claude is here.",  ja: "👋 クロードが来た。" },
  copilot: { zh: "👋 Copilot 來上班了。", en: "👋 Copilot is here.", ja: "👋 Copilotが来た。" },
  codex:   { zh: "👋 Codex 來上班了。",   en: "👋 Codex is here.",   ja: "👋 Codexが来た。" },
};

function sessionDemosFor(agent: AgentId): DemoItem[] {
  const g = SESSION_GREETING[agent];
  const items: DemoItem[] = [
    { label:"👋 SessionStart", bubble:g.zh, bubble_en:g.en, bubble_ja:g.ja, emotion:"relaxed", effect:"flash", duration:1200 },
    { label:"⚠️ Notification", bubble:"⚠️ 需要你回覆一下！", bubble_en:"⚠️ Your reply needed!", bubble_ja:"⚠️ 返信が必要です！", emotion:"angry", effect:"crisis", duration:2500 },
  ];
  // Stop: not fired by Copilot
  if (agent !== "copilot") {
    items.push({ label:"🎉 Stop", bubble:"🎉 好了。", bubble_en:"🎉 Done.", bubble_ja:"🎉 完了。", emotion:"relaxed", effect:"triumph", duration:2500 });
  }
  // SessionEnd: not fired by Codex
  if (agent !== "codex") {
    items.push({ label:"🌙 SessionEnd", bubble:"🌙 下次見～", bubble_en:"🌙 See you next time~", bubble_ja:"🌙 またね～", emotion:"neutral", effect:"flash", duration:1000 });
  }
  return items;
}

// Category keys map to i18n — titles resolved at render time. Session items
// are built dynamically per agent (see sessionDemosFor).
function categoriesFor(agent: AgentId) {
  return [
    { key: "demo.cat.slash"   as const, items: SLASH_DEMOS               },
    { key: "demo.cat.emotion" as const, items: EMOTION_DEMOS             },
    { key: "demo.cat.git"     as const, items: GIT_DEMOS                 },
    { key: "demo.cat.lang"    as const, items: LANG_DEMOS                },
    { key: "demo.cat.result"  as const, items: RESULT_DEMOS              },
    { key: "demo.cat.session" as const, items: sessionDemosFor(agent)    },
  ];
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  onMessage: (line: string) => void;
  onEmotion: (e: EmotionPreset) => void;
  onEffect:  (kind: EffectKind, msg: string, durationMs: number) => void;
  // Optional. When provided, the panel adapts to that agent (filters
  // session-lifecycle items the agent doesn't fire, and uses the right
  // welcome line). Defaults to "claude" for back-compat.
  agent?:    AgentId;
}

const OPEN_KEY = "lumina.demoPanel.open";

const PANEL_STYLE = { backgroundColor: "#514062", borderColor: "#856292" } as const;
const BTN_STYLE   = { backgroundColor: "#514062", borderColor: "#856292" } as const;

export function DemoPanel({ onMessage, onEmotion, onEffect, agent = "claude" }: Props) {
  const t = useT();
  const [locale] = useLocale();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  // Stable reference between renders unless the agent actually changes —
  // prevents re-allocating the 6-category array on every locale/state tick
  // and lets any future child memo work.
  const categories = useMemo(() => categoriesFor(agent), [agent]);

  useEffect(() => {
    setOpen(localStorage.getItem(OPEN_KEY) === "1");
  }, []);

  const toggle = () => setOpen(o => {
    const next = !o;
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    return next;
  });

  const fire = useCallback((item: DemoItem) => {
    // Read locale fresh at call time — avoids stale closure from useCallback
    const loc = getLocale();
    const bubble =
      loc === "en" && item.bubble_en ? item.bubble_en :
      loc === "ja" && item.bubble_ja ? item.bubble_ja :
      item.bubble;
    onMessage(bubble);
    onEmotion(item.emotion);
    onEffect(item.effect, bubble, item.duration);
    setSent(item.label);
    setTimeout(() => setSent(null), 600);
  }, [onMessage, onEmotion, onEffect]);

  return (
    <div className="absolute top-14 left-4 z-50 flex flex-col gap-1">
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggle}
        style={BTN_STYLE}
        className="self-start px-3 py-1.5 rounded-xl border-2 text-white text-[11px] font-bold shadow-2xl whitespace-nowrap"
      >
        {open ? "▾" : "▸"} {t("demo.title")}
        <span className="ml-1.5 text-[9px] font-normal text-white/60">
          · {agentDisplayName(agent)}
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div
          style={PANEL_STYLE}
          className="w-[220px] max-h-[75vh] overflow-y-auto rounded-xl border-2 shadow-2xl text-white"
        >
          {categories.map((cat) => (
            <div key={cat.key}>
              <div className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-widest text-white/50 font-bold">
                {t(cat.key)}
              </div>
              {cat.items.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between px-3 py-1 border-b border-white/10 last:border-0"
                >
                  <span className="text-[11px] truncate flex-1 pr-2">{item.label}</span>
                  <button
                    type="button"
                    onClick={() => fire(item)}
                    style={sent === item.label ? { opacity: 0.4 } : undefined}
                    className="shrink-0 text-[9px] px-2 py-0.5 rounded bg-primary hover:bg-primary-hover text-white transition-opacity"
                  >
                    {sent === item.label ? "✓" : t("demo.send")}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

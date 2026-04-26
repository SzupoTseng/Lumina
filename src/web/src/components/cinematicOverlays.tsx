// Cinematic overlays — DOM-only "moment" effects layered on top of the
// avatar canvas to mark significant outcomes:
//
//   TriumphMoment   — dark vignette + warm radial spotlight; fires on a
//                     big clean test pass. Generic "mastermind plan came
//                     together" vibe; no Death Note IP.
//   CrisisGlitch    — chromatic-aberration edges + scanlines; fires on
//                     a high-severity agentMonitor alert. Generic "system
//                     under stress" vibe; no Bocchi IP.
//
// Both are pure CSS/DOM. Mounted only while `active`. Self-clearing via
// the parent's setTimeout — no internal timers so React strict-mode
// double-mount doesn't double-schedule.

import { getLocale } from "@/features/i18n/i18n";

function loc(zh: string, en: string, ja: string) {
  const l = getLocale();
  return l === "en" ? en : l === "ja" ? ja : zh;
}

const TRIUMPH_LINE_DEFAULT = () => loc("🎯 一切都在計畫之中。", "🎯 All according to plan.", "🎯 計画通り。");
const CRISIS_LINE_DEFAULT  = () => loc("💥 系統壓力 critical…", "💥 System pressure critical…", "💥 システム負荷 critical…");

export function TriumphMoment({
  active,
  message,
}: {
  active: boolean;
  message?: string;
}) {
  const msg = message ?? TRIUMPH_LINE_DEFAULT();
  if (!active) return null;
  return (
    <div
      className={
        "absolute inset-0 z-25 pointer-events-none overflow-hidden " +
        "lumina-triumph-fade"
      }
      aria-hidden
    >
      {/* Dark vignette + warm center spotlight, single radial gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(255, 180, 90, 0.18) 0%, rgba(20, 10, 0, 0.0) 35%, rgba(0, 0, 0, 0.55) 90%)",
        }}
      />
      {/* Title line */}
      <div
        className={
          "absolute top-[18%] left-1/2 -translate-x-1/2 " +
          "text-amber-100 font-bold text-2xl tracking-widest " +
          "drop-shadow-[0_0_12px_rgba(255,150,40,0.8)]"
        }
      >
        {msg}
      </div>
    </div>
  );
}

export function CrisisGlitch({
  active,
  message,
}: {
  active: boolean;
  message?: string;
}) {
  const msg = message ?? CRISIS_LINE_DEFAULT();
  if (!active) return null;
  return (
    <div
      className={
        "absolute inset-0 z-50 pointer-events-none overflow-hidden " +
        "lumina-crisis-pulse"
      }
      aria-hidden
    >
      {/* Edge chromatic aberration: stacked box-shadows on a transparent
          frame, offset in opposite directions for the red/cyan split. */}
      <div className="absolute inset-2 lumina-crisis-edge" />
      {/* Scanline overlay — low-opacity repeating gradient */}
      <div className="absolute inset-0 lumina-crisis-scanlines" />
      {/* Title line */}
      <div
        className={
          "absolute top-[12%] left-1/2 -translate-x-1/2 " +
          "text-red-200 font-bold text-xl tracking-widest " +
          "drop-shadow-[0_0_10px_rgba(255,40,40,0.85)]"
        }
      >
        {msg}
      </div>
    </div>
  );
}

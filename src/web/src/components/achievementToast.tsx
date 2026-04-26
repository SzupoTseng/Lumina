// AchievementToast — transient gold-bordered notification when an
// achievement unlocks. Sits at top-center of the viewport, auto-dismisses
// after 5 s. Click to dismiss early.
//
// Single-toast at a time. If multiple unlocks fire on the same event (rare —
// would require a counter that crosses two thresholds simultaneously, which
// the current schema avoids), the parent should queue them and feed one at
// a time.

import { useEffect, useState } from "react";
import type { AchievementDef } from "@/features/achievements/achievements";

export function AchievementToast({
  achievement,
  onDismiss,
  durationMs = 5000,
}: {
  achievement: AchievementDef | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!achievement) return;
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      // small delay before clearing so the fade-out plays
      setTimeout(onDismiss, 250);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [achievement, durationMs, onDismiss]);

  if (!achievement) return null;

  return (
    <div
      className={
        "absolute top-6 left-1/2 -translate-x-1/2 z-[60] " +
        "transition-all duration-200 ease-out " +
        (visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2")
      }
      role="status"
      aria-live="polite"
      onClick={() => {
        setVisible(false);
        setTimeout(onDismiss, 200);
      }}
    >
      <div
        className={
          "flex items-center gap-3 cursor-pointer " +
          "bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 " +
          "text-amber-950 px-5 py-3 rounded-xl " +
          "shadow-[0_8px_30px_rgba(217,119,6,0.45)] " +
          "border-2 border-amber-200/60 backdrop-blur-sm"
        }
      >
        <div className="text-3xl drop-shadow-sm">{achievement.icon}</div>
        <div className="flex flex-col leading-tight">
          <div className="text-[10px] uppercase tracking-widest font-bold opacity-75">
            Achievement unlocked
          </div>
          <div className="text-base font-bold">{achievement.name}</div>
          <div className="text-xs opacity-80">{achievement.description}</div>
        </div>
      </div>
    </div>
  );
}

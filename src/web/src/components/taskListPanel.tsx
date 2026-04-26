// TaskListPanel — small overlay showing Claude's current task list.
//
// Renders pending and in-progress tasks; completed ones fade out by
// default. Empty state hides the panel entirely so it doesn't waste
// screen space during sessions where Claude doesn't use TaskCreate.
//
// Position: top-right, below the GitHub link icon, narrow column.

import type { TrackedTask } from "@/features/taskTracker/taskTracker";

const STATUS_GLYPH: Record<TrackedTask["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  deleted: "✕",
};

const STATUS_COLOR: Record<TrackedTask["status"], string> = {
  pending: "text-white/70",
  in_progress: "text-amber-300",
  completed: "text-emerald-400 line-through opacity-60",
  deleted: "text-white/30 line-through",
};

export function TaskListPanel({ tasks }: { tasks: TrackedTask[] }) {
  if (tasks.length === 0) return null;

  // Sort: in_progress > pending > completed; stable on insertion order.
  const sorted = tasks.slice().sort((a, b) => {
    const order: Record<TrackedTask["status"], number> = {
      in_progress: 0, pending: 1, completed: 2, deleted: 3,
    };
    return order[a.status] - order[b.status];
  });

  return (
    <div
      className={
        "absolute top-4 right-4 z-40 max-w-[260px] " +
        "bg-slate-900/85 backdrop-blur-md text-white " +
        "rounded-lg border border-white/15 shadow-2xl " +
        "px-3 py-2 flex flex-col gap-1"
      }
      role="region"
      aria-label="Claude task list"
    >
      <div className="text-[10px] uppercase tracking-widest font-bold text-white/60">
        Tasks
      </div>
      <ul className="flex flex-col gap-0.5 text-xs leading-snug">
        {sorted.slice(0, 8).map((t) => (
          <li
            key={t.id}
            className={"flex gap-2 items-start " + STATUS_COLOR[t.status]}
            title={t.description ?? t.subject}
          >
            <span className="font-mono shrink-0 w-3 text-center">
              {STATUS_GLYPH[t.status]}
            </span>
            <span className="truncate">
              {t.status === "in_progress" && t.activeForm
                ? t.activeForm
                : t.subject}
            </span>
          </li>
        ))}
        {sorted.length > 8 ? (
          <li className="text-[10px] text-white/40 italic">
            +{sorted.length - 8} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}

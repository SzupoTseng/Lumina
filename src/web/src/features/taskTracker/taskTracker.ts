// taskTracker — derives Claude Code's task-list state from the existing
// hook event stream. Listens for PostToolUse(TaskCreate / TaskUpdate /
// TaskList) and projects the result into a single Map keyed by task id.
//
// This is the buddy's structured-data equivalent of the speech bubble:
// instead of guessing "Claude said it will do X" by regex on response
// text, we read the harness's actual TaskCreate calls. Zero false
// positives, zero false negatives.
//
// State lives in localStorage so a tab refresh restores the current
// queue. State is per-browser-profile, NOT per-Claude-session, by design
// — multiple Claude sessions in the same window share the buddy's view.

import type { BuddyEvent } from "@/features/buddyEvents/buddyEvents";

const STORAGE_KEY = "lumina.taskTracker";
const SCHEMA_VERSION = 1;

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TrackedTask = {
  id: string;             // Claude's task id (string)
  subject: string;
  description?: string;
  status: TaskStatus;
  activeForm?: string;
  updatedAt: number;
};

export type TaskTrackerState = {
  version: number;
  tasks: Record<string, TrackedTask>;
  // Insertion order (also persisted because Object.keys is implementation
  // dependent across runtimes; explicit ordering keeps the panel stable).
  order: string[];
};

function emptyState(): TaskTrackerState {
  return { version: SCHEMA_VERSION, tasks: {}, order: [] };
}

export function loadTaskState(): TaskTrackerState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<TaskTrackerState>;
    if (parsed.version !== SCHEMA_VERSION) return emptyState();
    return {
      version: SCHEMA_VERSION,
      tasks: parsed.tasks ?? {},
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch {
    return emptyState();
  }
}

export function saveTaskState(state: TaskTrackerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / unavailable
  }
}

export function clearTaskState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// Claude Code's TaskCreate response includes the assigned id in the
// tool_response output, e.g. "Task #5 created successfully: ...". We pull
// the id from there because the tool_input only has subject/description.
const TASK_ID_PATTERN = /Task\s+#?(\S+?)\s+(?:created|updated|deleted)/i;

const cloneState = (s: TaskTrackerState): TaskTrackerState => ({
  version: s.version,
  tasks: { ...s.tasks },
  order: s.order.slice(),
});

const upsert = (state: TaskTrackerState, t: TrackedTask) => {
  if (!state.tasks[t.id]) state.order.push(t.id);
  state.tasks[t.id] = t;
};

// Pure: takes a state + event, returns a new state and whether anything
// changed (so the caller can avoid useless re-renders).
export function feedEvent(
  state: TaskTrackerState,
  evt: BuddyEvent,
): { state: TaskTrackerState; changed: boolean } {
  if (evt.type !== "PostToolUse") return { state, changed: false };
  const tool = evt.tool;
  if (
    tool !== "TaskCreate" &&
    tool !== "TaskUpdate" &&
    tool !== "TaskList"
  ) {
    return { state, changed: false };
  }

  const ctx = evt.context as
    | {
        tool_input?: {
          taskId?: string;
          subject?: string;
          description?: string;
          activeForm?: string;
          status?: TaskStatus;
        };
        tool_response?: { output?: string; isError?: boolean };
      }
    | undefined;

  const next = cloneState(state);
  const now = Date.now();

  if (tool === "TaskCreate") {
    const input = ctx?.tool_input ?? {};
    if (typeof input.subject !== "string") return { state, changed: false };
    // Recover assigned id from the response, fall back to subject hash.
    const out = String(ctx?.tool_response?.output ?? "");
    const m = out.match(TASK_ID_PATTERN);
    const id = m?.[1] ?? input.subject;
    upsert(next, {
      id,
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      status: "pending",
      updatedAt: now,
    });
    return { state: next, changed: true };
  }

  if (tool === "TaskUpdate") {
    const input = ctx?.tool_input ?? {};
    const id = input.taskId;
    if (typeof id !== "string") return { state, changed: false };
    const existing = next.tasks[id];
    if (!existing) {
      // Update arrived before create — synthesize a minimal entry.
      upsert(next, {
        id,
        subject: input.subject ?? `Task ${id}`,
        description: input.description,
        activeForm: input.activeForm,
        status: input.status ?? "pending",
        updatedAt: now,
      });
    } else {
      upsert(next, {
        ...existing,
        subject: input.subject ?? existing.subject,
        description: input.description ?? existing.description,
        activeForm: input.activeForm ?? existing.activeForm,
        status: input.status ?? existing.status,
        updatedAt: now,
      });
    }
    return { state: next, changed: true };
  }

  // TaskList itself doesn't mutate anything — we only persist on
  // create/update. Returning unchanged keeps localStorage write-pressure
  // low during sessions where Claude polls the list frequently.
  return { state, changed: false };
}

// Convenience for the panel: returns tasks in insertion order, optionally
// filtered to non-terminal ones.
export function visibleTasks(
  state: TaskTrackerState,
  opts: { hideCompleted?: boolean; hideDeleted?: boolean } = {},
): TrackedTask[] {
  const { hideCompleted = false, hideDeleted = true } = opts;
  return state.order
    .map((id) => state.tasks[id])
    .filter((t): t is TrackedTask => !!t)
    .filter((t) => {
      if (hideDeleted && t.status === "deleted") return false;
      if (hideCompleted && t.status === "completed") return false;
      return true;
    });
}

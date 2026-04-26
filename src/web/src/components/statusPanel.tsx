// StatusPanel — shows ccusage [Task] / [Scope] / [TODO] from status-bridge.sh
// Updates every time the bridge receives a StatusUpdate event.
// Positioned below StatusBar at top-centre.

import { type StatusInfo } from "@/features/buddyEvents/buddyEvents";

interface Props { info: StatusInfo | null }

export function StatusPanel({ info }: Props) {
  if (!info || (!info.task && !info.todo)) return null;

  return (
    <div
      className="absolute top-9 left-1/2 -translate-x-1/2 z-40 max-w-[70vw] px-4 py-1.5 rounded-full text-white text-[11px] font-mono"
      style={{ backgroundColor: "rgba(81,64,98,0.90)", borderColor: "#856292", border: "1px solid" }}
    >
      {info.task && (
        <span className="text-white/90">
          🎯 <span className="font-bold">{info.task}</span>
          {info.scope && <span className="text-white/60 ml-2">[{info.scope}]</span>}
        </span>
      )}
      {info.task && info.todo && <span className="mx-2 text-white/30">|</span>}
      {info.todo && (
        <span className="text-white/80">📋 {info.todo}</span>
      )}
    </div>
  );
}

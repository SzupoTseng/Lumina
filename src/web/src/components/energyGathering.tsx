// EnergyGathering — DOM overlay of cyan particles that drift from the
// viewport edges toward the avatar's center, used to give long-running
// shell tasks (npm install, docker build, terraform apply, etc.) a
// "concentration" visual instead of dead time.
//
// Pure DOM/CSS. No Three.js touch, no new deps, no copyrighted IP.
// Mounted only while `active` is true; particle DOM is unmounted on
// inactive so idle CPU stays at zero.
//
// To extend: bump PARTICLE_COUNT, adjust hue range, or wire a different
// trigger predicate in pages/index.tsx.

import { useMemo } from "react";

const DEFAULT_PARTICLE_COUNT = 28;

type Particle = {
  id: number;
  startTop: number;
  startLeft: number;
  delay: number;
  duration: number;
  hue: number;
  size: number;
};

export function EnergyGathering({
  active,
  message,
  particleCount = DEFAULT_PARTICLE_COUNT,
}: {
  active: boolean;
  message?: string;
  particleCount?: number;
}) {
  // Pre-computed once per active session so we don't churn random numbers
  // on every render. The dependency on `active` AND `particleCount`
  // ensures a fresh swarm at the right size if power mode changes mid-flight.
  const particles = useMemo<Particle[]>(() => {
    if (!active || particleCount <= 0) return [];
    return Array.from({ length: particleCount }, (_, i) => {
      const fromLeft = Math.random() < 0.5;
      return {
        id: i,
        startTop: Math.random() * 100,
        startLeft: fromLeft ? -3 - Math.random() * 5 : 103 + Math.random() * 5,
        delay: Math.random() * 2.5,
        duration: 2.6 + Math.random() * 2.4,
        hue: 195 + Math.random() * 40, // cyan → soft blue
        size: 6 + Math.random() * 6,
      };
    });
  }, [active, particleCount]);

  if (!active || particleCount <= 0) return null;

  return (
    <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full lumina-energy-particle"
          style={{
            top: `${p.startTop}%`,
            left: `${p.startLeft}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: `radial-gradient(circle, hsla(${p.hue}, 90%, 65%, 0.95) 0%, hsla(${p.hue}, 90%, 65%, 0) 70%)`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            filter: "blur(0.5px)",
          }}
        />
      ))}
      {message ? (
        <div
          className={
            "absolute top-1/4 left-1/2 -translate-x-1/2 " +
            "text-cyan-100 font-bold text-lg tracking-wide " +
            "drop-shadow-[0_0_8px_rgba(135,206,250,0.6)]"
          }
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

// Long-task command detector. Exported so pages/index.tsx can reuse the
// same predicate when triggering activation.
const LONG_TASK_PATTERN =
  /\b(?:npm|yarn|pnpm)\s+(?:install|ci)\b|\bpip\s+install\b|\bcargo\s+(?:build|fetch|update)\b|\bdocker\s+(?:build|push|pull|compose\s+up)\b|\bterraform\s+(?:apply|init|plan)\b|\bkubectl\s+apply\b|\bhelm\s+(?:install|upgrade)\b|\bnext\s+build\b|\bgo\s+build\b|\bbazel\s+build\b|\bgradle(?:w)?\s+build\b|\bmvn\s+(?:install|package)\b|\bbrew\s+install\b|\bapt(?:-get)?\s+install\b/;

export function isLongTaskCommand(command: string): boolean {
  return LONG_TASK_PATTERN.test(command);
}

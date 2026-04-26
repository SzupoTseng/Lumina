// powerMode — selectable performance profile.
//
// eco       — skip overlay activations (energy gathering, triumph,
//              crisis); the bubble line still fires. Lowest CPU/GPU
//              cost. Targeted at low-end laptops or background usage.
// balanced  — current default behavior. All overlays fire normally.
// ultra     — overlays fire with bumped parameters: more particles,
//              slightly longer durations, fuller visuals.
//
// State lives in localStorage["lumina.powerMode"]. Pure functions; UI
// component is in src/components/powerModeSelector.tsx.

const STORAGE_KEY = "lumina.powerMode";

export type PowerMode = "eco" | "balanced" | "ultra";
const VALID: ReadonlyArray<PowerMode> = ["eco", "balanced", "ultra"];

export const DEFAULT_POWER_MODE: PowerMode = "balanced";

export function loadPowerMode(): PowerMode {
  if (typeof window === "undefined") return DEFAULT_POWER_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID as ReadonlyArray<string>).includes(raw)) {
      return raw as PowerMode;
    }
  } catch {
    // ignore
  }
  return DEFAULT_POWER_MODE;
}

export function savePowerMode(mode: PowerMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

// Per-mode tuning constants. Components/wiring read these instead of
// hard-coding values, so changing the table here cascades everywhere.
export const POWER_TUNING: Record<
  PowerMode,
  {
    overlaysEnabled: boolean;
    energyParticleCount: number;
    energyDurationMs: number;
    triumphDurationMs: number;
    crisisDurationMs: number;
  }
> = {
  eco: {
    overlaysEnabled: false,
    energyParticleCount: 0,
    energyDurationMs: 0,
    triumphDurationMs: 0,
    crisisDurationMs: 0,
  },
  balanced: {
    overlaysEnabled: true,
    energyParticleCount: 28,
    energyDurationMs: 6000,
    triumphDurationMs: 4200,
    crisisDurationMs: 3200,
  },
  ultra: {
    overlaysEnabled: true,
    energyParticleCount: 56,
    energyDurationMs: 8000,
    triumphDurationMs: 5500,
    crisisDurationMs: 4000,
  },
};

export const STORAGE_KEY_EXPORT = STORAGE_KEY; // re-exported for cross-tab sync wiring

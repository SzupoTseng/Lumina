// vrmWind — adds a subtle, time-varying horizontal force to VRM spring
// bones so hair / skirt / accessories drift as if there were a breeze.
//
// Why this approach:
//   `@pixiv/three-vrm@1.0.9` does not expose a `wind` or `externalForce`
//   on spring bones — only per-joint `gravityDir` (THREE.Vector3) and
//   `gravityPower`. The cleanest way to fake wind is to tilt each joint's
//   gravity direction by a small horizontal vector each frame. The spring
//   simulation then naturally relaxes toward the tilted "down".
//
// Why a WeakMap of originals:
//   We mutate `joint.settings.gravityDir` in place every frame. To avoid
//   permanent drift (and to support reverting when wind is disabled) we
//   stash the original direction the first time we touch each joint.
//
// Per-frame cost: O(n_joints) — typically a few dozen for a VRoid model.

import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

export type WindSettings = {
  enabled: boolean;
  amplitude: number; // horizontal tilt magnitude added to gravity (0..~0.6)
  frequency: number; // base oscillation rate, Hz
  gust: number;      // 0..1, fast-noise component layered on the base sway
};

export const WIND_OFF: WindSettings = {
  enabled: false,
  amplitude: 0,
  frequency: 0,
  gust: 0,
};
export const WIND_GENTLE: WindSettings = {
  enabled: true,
  amplitude: 0.18,
  frequency: 0.3,
  gust: 0.25,
};
export const WIND_STRONG: WindSettings = {
  enabled: true,
  amplitude: 0.4,
  frequency: 0.55,
  gust: 0.45,
};

const ORIGINAL_GRAVITY = new WeakMap<object, THREE.Vector3>();
const tmpDir = new THREE.Vector3();

export function applyWind(
  vrm: VRM,
  tSeconds: number,
  settings: WindSettings,
): void {
  const sm = vrm.springBoneManager;
  if (!sm) return;
  const joints = sm.joints;
  if (!joints || joints.size === 0) return;

  if (!settings.enabled) {
    // Restore originals so disabling wind doesn't leave a tilt baked in.
    for (const j of joints) {
      const orig = ORIGINAL_GRAVITY.get(j as unknown as object);
      if (orig) j.settings.gravityDir.copy(orig);
    }
    return;
  }

  const w = settings.frequency * Math.PI * 2;
  const baseX = Math.sin(tSeconds * w);
  const baseZ = Math.cos(tSeconds * w * 0.8 + 1.3);
  const gustX = Math.sin(tSeconds * settings.frequency * 7) * settings.gust;
  const gustZ = Math.cos(tSeconds * settings.frequency * 6.3) * settings.gust;
  const offX = (baseX + gustX) * settings.amplitude;
  const offZ = (baseZ + gustZ) * settings.amplitude;

  for (const j of joints) {
    const key = j as unknown as object;
    let orig = ORIGINAL_GRAVITY.get(key);
    if (!orig) {
      orig = j.settings.gravityDir.clone();
      ORIGINAL_GRAVITY.set(key, orig);
    }
    tmpDir.copy(orig);
    tmpDir.x += offX;
    tmpDir.z += offZ;
    tmpDir.normalize();
    j.settings.gravityDir.copy(tmpDir);
  }
}

export function windForPowerMode(mode: "eco" | "balanced" | "ultra"): WindSettings {
  if (mode === "eco") return WIND_OFF;
  if (mode === "ultra") return WIND_STRONG;
  return WIND_GENTLE;
}

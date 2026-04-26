// Default VRM model URL.
//
// Resolution order:
//   1. NEXT_PUBLIC_DEFAULT_VRM_URL env var, if set (build-time inlined by Next).
//   2. /avatar.vrm — drop your VRoid/Booth/etc. download at
//      src/web/public/avatar.vrm and it loads on every dev-server restart.
//   3. The IPFS fallback below — used iff /avatar.vrm 404s, so this works
//      out of the box on a fresh clone with no asset bundled.
//
// To swap the buddy model: place <name>.vrm in src/web/public/ and either
// rename it to avatar.vrm or set NEXT_PUBLIC_DEFAULT_VRM_URL=/<name>.vrm
// in src/web/.env.local. Drag-and-drop onto the canvas still works for
// session-only swaps.
//
// The IPFS gateway is occasionally slow; prefer a local file once you have
// one. License of the IPFS-hosted sample is whatever ChatVRM upstream
// shipped — see docs/upstream-baseline.md before redistributing.

export const DEFAULT_VRM_FALLBACK_URL =
  "https://ipfs.io/ipfs/bafybeihx4xjb5mphocdq2os63g43pgnpi46ynolpmhln3oycoasywdnl3u";

export const DEFAULT_VRM_LOCAL_URL = "/avatar.vrm";

export const DEFAULT_VRM_URL =
  process.env.NEXT_PUBLIC_DEFAULT_VRM_URL ||
  DEFAULT_VRM_LOCAL_URL;

// localStorage key shared by ModelSelector (writes) and vrmViewer (reads on
// mount). Last user choice wins over the env/fallback chain so reloading the
// tab keeps the same buddy.
export const SELECTED_MODEL_STORAGE_KEY = "lumina.selectedVrmModel";

// localStorage key for PersonalitySelector. Stores the personality id
// (filename stem of the .json under public/personalities/).
export const SELECTED_PERSONALITY_STORAGE_KEY = "lumina.selectedPersonality";

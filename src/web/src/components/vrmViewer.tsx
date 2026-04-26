import { useContext, useCallback } from "react";
import { ViewerContext } from "../features/vrmViewer/viewerContext";
import { buildUrl } from "@/utils/buildUrl";
import {
  DEFAULT_VRM_URL,
  DEFAULT_VRM_LOCAL_URL,
  DEFAULT_VRM_FALLBACK_URL,
  SELECTED_MODEL_STORAGE_KEY,
} from "@/features/constants/vrmConstants";

// Resolution chain (first hit wins):
//   1. localStorage[SELECTED_MODEL_STORAGE_KEY] — the user's last pick from
//      ModelSelector. Trusted, no probe (the dropdown only stores valid paths).
//   2. NEXT_PUBLIC_DEFAULT_VRM_URL env override — also trusted, no probe.
//   3. /avatar.vrm — HEAD-probed; falls through if missing.
//   4. IPFS sample — last resort so a fresh clone still shows a model.
async function resolveDefaultVrm(): Promise<string> {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
    if (stored) return stored;
  }
  const configured = DEFAULT_VRM_URL;
  if (configured !== DEFAULT_VRM_LOCAL_URL) {
    return configured;
  }
  try {
    const probe = await fetch(buildUrl(configured), { method: "HEAD" });
    if (probe.ok) return configured;
  } catch {
    // network failure on local fetch is unusual — fall through to fallback.
  }
  return DEFAULT_VRM_FALLBACK_URL;
}

export default function VrmViewer() {
  const { viewer } = useContext(ViewerContext);

  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (!canvas) return;
      viewer.setup(canvas);
      resolveDefaultVrm().then((url) => {
        viewer.loadVrm(url.startsWith("/") ? buildUrl(url) : url);
      });

      // Drag-and-drop a .vrm onto the canvas to swap models for this session.
      canvas.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      canvas.addEventListener("drop", (event) => {
        event.preventDefault();

        const files = event.dataTransfer?.files;
        if (!files) return;

        const file = files[0];
        if (!file) return;

        const file_type = file.name.split(".").pop();
        if (file_type === "vrm") {
          const blob = new Blob([file], { type: "application/octet-stream" });
          const url = window.URL.createObjectURL(blob);
          viewer.loadVrm(url);
        }
      });
    },
    [viewer]
  );

  return (
    <div className={"absolute top-0 left-0 w-screen h-[100svh] -z-10"}>
      <canvas ref={canvasRef} className={"h-full w-full"}></canvas>
    </div>
  );
}

// ModelSelector — dropdown over all .vrm files in public/models/.
//
// Auto-discovery: fetches /api/models on mount; no hardcoded list. Persists
// the user's choice in localStorage under SELECTED_MODEL_STORAGE_KEY so
// vrmViewer's initial-load resolver picks the same model on refresh.
//
// Renders nothing if discovery returns zero models — the existing default
// chain in vrmViewer (env → /avatar.vrm → IPFS fallback) still runs.
//
// Drag-and-drop onto the canvas remains the per-session fast path; this
// component is for persisted selection across reloads.

import { useContext, useEffect, useState } from "react";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { buildUrl } from "@/utils/buildUrl";
import { SELECTED_MODEL_STORAGE_KEY } from "@/features/constants/vrmConstants";
import { useT } from "@/features/i18n/i18n";

type ModelEntry = { name: string; path: string };

export function ModelSelector() {
  const { viewer } = useContext(ViewerContext);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch(buildUrl("/api/models"))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: { models?: ModelEntry[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.models) ? data.models : [];
        setModels(list);
        if (list.length === 0) return;

        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)
            : null;
        const initial =
          stored && list.some((m) => m.path === stored)
            ? stored
            : list[0].path;
        setSelected(initial);
      })
      .catch((err) => {
        console.warn("[modelSelector] discovery failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const path = e.target.value;
    setSelected(path);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, path);
    }
    viewer.loadVrm(buildUrl(path));
  };

  // Cross-tab sync: storage events fire in OTHER tabs of the same origin
  // when localStorage changes, never in the tab that wrote the value, so no
  // self-loop. Browser-native, no bridge involvement.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SELECTED_MODEL_STORAGE_KEY || !e.newValue) return;
      if (e.newValue === selected) return;
      setSelected(e.newValue);
      viewer.loadVrm(buildUrl(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [selected, viewer]);

  const t = useT();
  if (models.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="lumina-model-selector"
        className="text-[10px] text-white/90 uppercase tracking-widest font-bold drop-shadow"
      >
        {t("settings.buddy")}
      </label>
      <select
        id="lumina-model-selector"
        value={selected}
        onChange={handleChange}
        aria-label="Select VRM model"
        className="bg-primary text-white px-3 py-2 rounded-md border border-primary-hover text-sm cursor-pointer hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {models.map((m) => (
          <option key={m.path} value={m.path}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// PowerModeSelector — Eco / Balanced / Ultra dropdown. Same shape as
// modelSelector and personalitySelector: localStorage-persisted,
// cross-tab synced via the storage event.

import { useEffect, useState } from "react";
import {
  loadPowerMode,
  savePowerMode,
  STORAGE_KEY_EXPORT,
  type PowerMode,
} from "@/features/powerMode/powerMode";
import { useT } from "@/features/i18n/i18n";

// Option labels and hints come from the i18n table at render time so
// switching language re-labels the dropdown without reload.
const OPTION_IDS: ReadonlyArray<PowerMode> = ["eco", "balanced", "ultra"];

export function PowerModeSelector({
  onChange,
}: {
  onChange?: (mode: PowerMode) => void;
}) {
  const [mode, setMode] = useState<PowerMode>("balanced");

  useEffect(() => {
    const initial = loadPowerMode();
    setMode(initial);
    if (onChange) onChange(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-tab sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY_EXPORT || !e.newValue) return;
      const next = e.newValue as PowerMode;
      if (next !== mode) {
        setMode(next);
        if (onChange) onChange(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [mode, onChange]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as PowerMode;
    setMode(next);
    savePowerMode(next);
    if (onChange) onChange(next);
  };

  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="lumina-power-mode-selector"
        className="text-[10px] text-white/90 uppercase tracking-widest font-bold drop-shadow"
      >
        {t("settings.power")}
      </label>
      <select
        id="lumina-power-mode-selector"
        value={mode}
        onChange={handleChange}
        aria-label="Select power mode"
        title={t(`power.${mode}.hint` as any)}
        className="bg-primary text-white px-3 py-2 rounded-md border border-primary-hover text-sm cursor-pointer hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {OPTION_IDS.map((id) => (
          <option key={id} value={id} title={t(`power.${id}.hint` as any)}>
            {t(`power.${id}` as any)}
          </option>
        ))}
      </select>
    </div>
  );
}

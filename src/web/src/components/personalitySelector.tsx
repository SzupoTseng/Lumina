// PersonalitySelector — dropdown over public/personalities/*.json.
//
// Two side-effects on selection:
//   1. Calls onPersonalityChange(personality) so the parent can update the
//      LLM systemPrompt and the buddyEvents personality ref.
//   2. Persists the chosen id in localStorage under the shared storage key.
//
// Rendering nothing while the discovery fetch is in flight, and nothing if
// no personality files are present — keeps the UI clean for fresh installs.

import { useEffect, useState } from "react";
import { buildUrl } from "@/utils/buildUrl";
import { SELECTED_PERSONALITY_STORAGE_KEY } from "@/features/constants/vrmConstants";
import { useT, useLocale } from "@/features/i18n/i18n";

export type Personality = {
  id: string;
  name: string;
  name_en?: string;
  name_ja?: string;
  systemPrompt: string;
  defaultEmotion?: "neutral" | "happy" | "angry" | "sad" | "relaxed";
  reactions?: Record<string, string>;
};

export function PersonalitySelector({
  onPersonalityChange,
}: {
  onPersonalityChange: (p: Personality | null) => void;
}) {
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch(buildUrl("/api/personalities"))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: { personalities?: Personality[] }) => {
        if (cancelled) return;
        const list = Array.isArray(data.personalities) ? data.personalities : [];
        setPersonalities(list);
        if (list.length === 0) {
          onPersonalityChange(null);
          return;
        }

        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(SELECTED_PERSONALITY_STORAGE_KEY)
            : null;
        const chosen =
          (stored && list.find((p) => p.id === stored)) || list[0];
        setSelectedId(chosen.id);
        onPersonalityChange(chosen);
      })
      .catch((err) => {
        console.warn("[personalitySelector] discovery failed", err);
      });
    return () => {
      cancelled = true;
    };
    // onPersonalityChange ref churns on every parent render; we only want
    // discovery once. The parent is responsible for stable setters or for
    // tolerating that initial application is one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_PERSONALITY_STORAGE_KEY, id);
    }
    const found = personalities.find((p) => p.id === id) ?? null;
    onPersonalityChange(found);
  };

  // Cross-tab sync: storage events fire in OTHER tabs only, so no loop.
  // We rely on the personalities list already being cached in state — no
  // re-fetch on every cross-tab change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SELECTED_PERSONALITY_STORAGE_KEY || !e.newValue) return;
      if (e.newValue === selectedId) return;
      const found = personalities.find((p) => p.id === e.newValue);
      if (!found) return;
      setSelectedId(found.id);
      onPersonalityChange(found);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [selectedId, personalities, onPersonalityChange]);

  const t = useT();
  const [locale] = useLocale();
  if (personalities.length === 0) return null;

  const displayName = (p: Personality) => {
    if (locale === "en" && p.name_en) return p.name_en;
    if (locale === "ja" && p.name_ja) return p.name_ja;
    return p.name;
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="lumina-personality-selector"
        className="text-[10px] text-white/90 uppercase tracking-widest font-bold drop-shadow"
      >
        {t("settings.persona")}
      </label>
      <select
        id="lumina-personality-selector"
        value={selectedId}
        onChange={handleChange}
        aria-label="Select personality"
        className="bg-primary text-white px-3 py-2 rounded-md border border-primary-hover text-sm cursor-pointer hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {personalities.map((p) => (
          <option key={p.id} value={p.id}>
            {displayName(p)}
          </option>
        ))}
      </select>
    </div>
  );
}

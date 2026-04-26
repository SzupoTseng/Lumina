# Swap the Buddy VRM Model

Four ways to use a custom model. Pick by how persistent and how interactive you want the swap.

## 1. Drop-in library (auto-discovery — RECOMMENDED for daily use)

1. Save any number of `.vrm` files into `src/web/public/models/`.
2. **If running from Windows (via `start-Lumina.bat`)**: The dev server actually runs in a native WSL file system clone (`~/lumina-runtime`) to bypass DrvFs bugs. You must **restart Lumina** (close the window and run the `.bat` again) so the new `.vrm` file syncs over via `rsync`.
3. Refresh the tab (or wait for the app to reload). The dropdown in the top-left lists all of them.
4. Pick one — selection is persisted in `localStorage` (`lumina.selectedVrmModel`) and reloaded on every future visit.

Wiring: `pages/api/models.ts` reads the directory at request time; `components/modelSelector.tsx` fetches that list and calls `viewer.loadVrm()` on change. No hardcoded list.

Filename → display name: `cool-vroid.vrm` shows as `cool-vroid`. Rename the file to rename the option.

Best for: anyone with more than one buddy on hand.

## 2. Drag-and-drop (per-session, zero config)

While the dev server is running and the buddy is visible, drag a `.vrm` file directly onto the 3D canvas. The model loads via `URL.createObjectURL(blob)` and lives until the tab refreshes (does **not** persist to localStorage).

Best for: trying a model from VRoid Hub or Booth without committing it to disk.

## 3. Drop-in default (single file, no UI)

1. Save your `.vrm` as `src/web/public/avatar.vrm`.
2. Reload the tab.

`vrmViewer.tsx` HEAD-checks `/avatar.vrm` on first load if no localStorage choice exists. The auto-discovery API will also surface this file as `avatar (legacy)` in the dropdown.

Best for: legacy single-model setup; if you only ever use one buddy.

## 4. Env-pinned URL (deployments, custom CDN)

In `src/web/.env.local`:

```
NEXT_PUBLIC_DEFAULT_VRM_URL=https://your-cdn.example/buddy.vrm
```

Or to point at a different name in `public/`:

```
NEXT_PUBLIC_DEFAULT_VRM_URL=/buddy-friday.vrm
```

When this env var is set, the local-file probe is skipped — the value is trusted and used directly. Note that a localStorage selection (option 1) still wins, since the user's explicit choice should out-rank the deployment default.

Best for: production builds, A/B testing different models, dropping a network-served VRM behind auth.

## Resolution priority

When the page loads with no drag-drop, the order is:

1. `localStorage[lumina.selectedVrmModel]` — last ModelSelector choice
2. `NEXT_PUBLIC_DEFAULT_VRM_URL` — env override
3. `/avatar.vrm` — HEAD-probed, falls through if 404
4. The IPFS sample — last-resort fallback so a fresh clone always shows something

## Where to get free models

- **VRoid Hub** (`hub.vroid.com`) — filter by license. Look for "Allowed for personal/commercial use" + "Allowed to be modified" if you plan to edit in VRoid Studio. Click the model → **Download VRM**.
- **Booth** (`booth.pm`) — search "VRM 無料" / "free". Read each shop's terms; "二次配布" (redistribution) is rarely allowed even when use is free.
- **VRoid Studio** — generate your own from scratch. Free, official, exports clean VRM 1.0.

Always double-check the license before committing the file to this repo. If the license forbids redistribution, **don't commit it** — keep the file in `public/avatar.vrm` locally and add `public/avatar.vrm` to `.gitignore` when we add one.

## VRM 0.x vs 1.0 expression names

`buddyEvents.ts` uses VRM 1.0 preset names: `neutral | happy | angry | sad | relaxed`. If a model exports VRM 0.x with the old names (`Joy | Sorrow | Fun | Angry | Neutral`), `@pixiv/three-vrm` 1.x maps them automatically — no code change needed. Don't add `joy`/`sorrow`/`fun` to `EmotionPreset`; they're not in the 1.0 spec and TypeScript will reject them.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Pushed `.vrm` file doesn't appear in the dropdown | Working on DrvFs/Windows but didn't restart Lumina | The Next.js API route reads `~/lumina-runtime/` on WSL, not your Windows `D:\` drive. Restart `start-Lumina.bat` to trigger the `rsync` sync script. |
| Model loads grey/untextured | Some VRoid exports omit MToon material variants | Open in VRoid Studio, re-export with "Standard MToon" enabled |
| Avatar floats above ground | VRM hips bone offset; mostly cosmetic | Adjust camera in `viewer.ts` or use a model with neutral hips |
| Buddy never emotes despite events arriving | Model lacks expression presets — common with low-poly imports | Open in VRoid Studio → Expression tab → assign presets to `happy`/`angry`/`sad`/`relaxed`/`neutral`. Re-export. |
| `/avatar.vrm` 404s in DevTools | File missing from `src/web/public/` | Either drop the file there or set `NEXT_PUBLIC_DEFAULT_VRM_URL` to point elsewhere |

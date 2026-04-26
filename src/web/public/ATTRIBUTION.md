# Asset Attribution

本專案用到的所有 3D 模型、動畫、紋理都是第三方創作者的作品。
AgentOffice 僅作**教育/研究用途**，不商業化、不公開配布原始 VRM/GLB 檔。

如果你是原創作者並希望本條目更動/移除，請在 GitHub 開 issue。

---

## VRoid Hub VRM Models (default mode, `public/*.vrm`)

> 預設 6 個 agent，載入於 `src/main.ts`。來源都是 [VRoid Hub](https://hub.vroid.com/)。

| File | 作者 | VRoid Hub URL | 授權標籤 | 備註 |
|---|---|---|---|---|
| `avatar.vrm` | _填_ | _填_ | 個人利用:OK / 商用:? / 改変:? / クレジット:? | _填_ |
| `alicia.vrm` | _填_ | _填_ | 個人利用:OK / 商用:? / 改変:? / クレジット:? | _填_ |
| `seed.vrm` | _填_ | _填_ | 個人利用:OK / 商用:? / 改変:? / クレジット:? | _填_ |
| `vroid_a.vrm` | _填_ | _填_ | 個人利用:OK / 商用:? / 改変:? / クレジット:? | _填_ |
| `vroid_b.vrm` | _填_ | _填_ | 個人利用:OK / 商用:? / 改変:? / クレジット:? | _填_ |
| `vroid_c.vrm` | _填_ | _填_ | 個人利用:OK / 商用:? / 改変:? / クレジット:? | _填_ |

---

## DOA6 Models (`?doa=1` mode, `public/vrm/*.vrm`)

> 從 Dead or Alive 6 game assets 提取，經 MMD → VRM pipeline 轉換。
> **Koei Tecmo 版權**。僅限 educational / research use，**絕不商業化 / 配布**。

| File | 原角色 | 提取來源 |
|---|---|---|
| `kasumi_sb.vrm` | かすみ | DOA6 |
| `mai_sb.vrm` | Mai Shiranui | DOA6 (DLC) |
| `momiji_sb.vrm` | 紅葉 | DOA6 |
| `kasumi_alt_sb.vrm` | かすみ (alt costume) | DOA6 |

---

## Umamusume MMD Models (`?fan=1` mode, `public/fan/*.vrm`)

> ShiniNet 式 MMD 模型，從各 creator 的 BOOTH 下載後經 PMX → VRM pipeline 轉換。
> 原 PMX 作者授權通常為「二次配布禁止 / 改造 OK / 非商用」等嚴格條款。
> 本 repo 只放**轉換後的 VRM**，不含原 PMX 檔案。

| File | 原 MMD 作者 (ShiniNet 系列) | BOOTH / Twitter | 備註 |
|---|---|---|---|
| `ayabe.vrm` | ShiniNet 式アヤベさん | _填 BOOTH URL_ | 顔アウトライン無し material 保留 |
| `kitasan.vrm` | ShiniNet 式キタちゃん | _填_ | ハイライト material polys 已 strip 修鼻白點 |
| `mayano.vrm` | ShiniNet 式マーちゃん | _填_ | |
| `dreitzehn.vrm` | ドライツェーン | _填_ | |
| `vicara.vrm` | ビカラ | _填_ | |
| `manhattan_cafe.vrm` | マンハッタンカフェ (ShiniNet 式) | _填_ | 私服 v1.0 |

---

## fan=2 VRM (`?fan=2` mode, `public/fan2/*.vrm`)

| File | 原作者 / 出處 | 格式 | 備註 |
|---|---|---|---|
| `aqua.vrm` | _填_ | Koikatsu → VRM | この素晴らしい世界に祝福を! — drop retry |
| `psylocke.vrm` | _填_ | Marvel Rivals PMX → VRM | |

---

## Mixamo Animations (`src/fbx/*.fbx`)

[Mixamo (Adobe)](https://www.mixamo.com/) — Adobe account free tier.
Mixamo 條款允許在任何專案中使用（含商業），但不可重新上傳到其他動畫庫。

本 repo 保留 `src/fbx/` 源 FBX 檔案僅為方便 dev 時 reload，
最終 VRM 綁動畫的 runtime retarget 邏輯在 `src/animations.ts`。

---

## 修改紀錄

- 2026-04-21 初版（待補作者資訊）

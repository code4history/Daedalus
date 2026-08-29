# Daedalus

[![CI](https://github.com/code4history/Daedalus/actions/workflows/test.yml/badge.svg)](https://github.com/code4history/Daedalus/actions/workflows/test.yml)

`@c4h/daedalus` fits world-file parameters for a known CRS.

- Input: GCPs plus a single CRS
- Output: `world_file_basic` and post-shear refinement
- Runtime: Node.js と browser。browser は**行ごとに実績が違う**ため 3 段に分けて書く（m3-t1）。**(1) バンドル可能性 = 検証済**: Teiresias の `pnpm run verify:demo-bundle`（`scripts/verify-demo-browser-bundle.mjs`）が demo build の出力チャンクを走査し、Node 固有指定子が残っていないことと Daedalus 由来コードが実在することを機械検証する（CI から継続的に走る）。**(2) 実ブラウザでの実行 = 観測済（「検証済」ではない）**: 2026-08-29 に Teiresias デモを実ブラウザで **1 回観測**した（m3-t1/AC-16）。1 回の観測は自動検査ではない ∴ 回帰を守らない。**(3) CI 上での継続的・自動のブラウザ実行と canvas ドラッグの自動操作 = 未検証**（Cycle 1 の既知欠落）。`Daedalus/src` は本件のために 1 バイトも変更していない（m0 凍結を解いていない）
- Scope: fitting only, not CRS candidate lookup

English README is [here](./README.md).

## 公開 API

```ts
import { fitWorldFile } from '@c4h/daedalus';
const result = fitWorldFile(gcps, options);
```

`fitWorldFile` と型のみが公開である。affine / F 検定の helper は package-internal であり
`src/index.ts` からは export しない。

### `FitOptions`

| option | 既定値 | 有効範囲 | 範囲外・非有限のとき |
|---|---|---|---|
| `geoBasis` | `lonlat_deg` / `lon-lat` 相当 | `lonlat_deg`(`lon-lat`) / `planar_xy`(`xy`) | `axisOrder: 'lat-lon'` は `unsupportedAxisOrder` で `unusable` |
| `debug` | `false` | boolean | — |
| `collinearityThreshold` | `0.01` | 閉区間 `[0,1]` | 既定値へ正規化（warning は追加しない） |
| `alpha` | `0.05` | **開区間** `(0,1)` | `0` / `1` を含む範囲外と非有限は既定値へ正規化 |
| `minRelativeImprovement` | `0.01` | 閉区間 `[0,1]` | 既定値へ正規化 |
| `normalizeEpsilonMeters` | `100.0` | 正の実数 | — |
| `holdout` | 未指定 | `GcpPair[]` | 非空 holdout に非有限 pixel/geo が 1 つでもあれば入力不正 |

`collinearityThreshold` の `0` は「固有値比が厳密に 0 の完全共線だけを skip」する端点、
`1` は「有限な固有値比を全て skip」する明示設定である。
`minRelativeImprovement` の `0` は統計 gate のみで採否を決める設定、`1` は training SSE の
完全除去だけを許す設定である。

### 返却値の観測契約

| field | 内容 |
|---|---|
| `status` | warning が 1 件以上なら `ok_with_warnings`、0 件なら `ok`。入力不正は `insufficient` |
| `qualityGate` | n=2 は `preview`、入力不正は `unusable`、それ以外は `adoptable` |
| `worldFile` | 選択モデル（affine 採用時は affine、不採用時は similarity）。入力不正は `null` |
| `similarityOnly` | affine を採用したときのみ `false` |
| `rmsMeters` | **選択モデル**の training 側 1 点あたり 2D 距離 RMS = `sqrt(SSE / n)`。入力不正は `null` |
| `rmsPixels` | 選択モデルの逆写像による pixel 側 RMS |
| `warnings` | 下表のコード。`affineRejectedNonImproving` には不採用理由が `detail` に入る |
| `debug` | `options.debug` が真のときのみ存在（下記） |

### warning コードと判定順序

判定は上から順に評価し、最初に該当した分岐で確定する。

| # | 条件 | `similarityOnly` | worldFile | qualityGate | warnings |
|---|---|---|---|---|---|
| 0 | n<2 / training または非空 holdout の非有限 pixel・geo / 全 training pixel 一致 / `L_geo < normalizeEpsilonMeters` / `axisOrder: 'lat-lon'` | `true` | `null` | `unusable` | 空（axisOrder のみ `unsupportedAxisOrder`） |
| 1 | n=2 | `true` | similarity | `preview` | `insufficientPointCount`, `affineSkippedInsufficientDof` |
| 2 | n=3,4 | `true` | similarity | `adoptable` | `affineSkippedInsufficientDof`（共線なら `nearCollinearSource` も） |
| 3 | n>=5 かつ λ2/λ1 <= `collinearityThreshold` | `true` | similarity | `adoptable` | `nearCollinearSource`, `affineSkippedCollinear` |
| 4 | n>=5 かつ affine 解なし / 非有限 / 負の改善 / similarity が数値許容内で厳密適合 | `true` | similarity | `adoptable` | `affineRejectedNonImproving`（+ `validationSkipped`※） |
| 5 | n>=5 かつ F gate 不成立 | `true` | similarity | `adoptable` | `affineRejectedNonImproving`（+ `validationSkipped`※） |
| 6 | n>=5 かつ相対改善 gate 不成立 | `true` | similarity | `adoptable` | `affineRejectedNonImproving`（+ `validationSkipped`※） |
| 7 | n>=5 かつ holdout RMS 悪化 | `true` | similarity | `adoptable` | `affineRejectedNonImproving`（detail に holdout 記載） |
| 8 | n>=5 かつ全 gate 通過 | `false` | affine | `adoptable` | `validationSkipped`※ |

※ `validationSkipped` は **affine 評価に到達（n>=5 かつ非共線）かつ `holdout` 未指定/空**のとき、
affine 採用可否にかかわらず必ず発出する。n<5 と共線 skip では holdout 検証に到達しないため発出しない。

### affine 採用ゲート

similarity（4 パラメータ）は affine（6 パラメータ）の制約部分モデルなので `df1 = 2` は常に成り立ち、
affine の残差自由度は `df2 = 2n-6` である。採用は次の**両方**を満たす場合のみ。

1. **F gate**: `F > criticalF(alpha, 2, 2n-6)`。`F = ((SSE4-SSE6)/2) / (SSE6/(2n-6))`。
   `criticalF(alpha, 2, df2) = (df2/2)·(alpha^(-2/df2) - 1)`
2. **相対改善 gate**: `(SSE4-SSE6)/SSE4 >= minRelativeImprovement`

`holdout` を指定した場合はさらに `holdoutRmsAffine <= holdoutRmsSimilarity` を要求する。

**SSE の数値的ゼロ**は厳密比較ではなく許容つきで判定する（仕様正本の「数値許容内の厳密適合」）。

```
epsSSE = 1024 · Number.EPSILON² · Σ(X² + Y²)      （和は training GCP の geo 座標）
Z(s)   = (s <= epsSSE)
```

- `Z(SSE4)`: similarity が既に許容内で厳密適合 ∴ 改善余地なし。F を評価せず不採用（#4）
- `Z(SSE6)` かつ `¬Z(SSE4)`: `F = +Infinity` として F gate を通す

`alpha = 0.05` / `minRelativeImprovement = 0.01` / 安全係数 `1024` は実データで較正した値ではなく、
Cycle 1 の過適合抑制のための初期ヒューリスティック（仮仕様）である。

### `debug`（`options.debug` が真のときのみ）

| field | 存在条件 |
|---|---|
| `sse` / `mse` | 常に（**選択モデル**の training SSE と `sse/n`） |
| `sseSimilarity` / `sseZeroTolerance` | affine 評価に到達したとき（#4〜#8） |
| `sseAffine` | affine を計算できたとき |
| `fStatistic` / `criticalF` / `relativeImprovement` | F gate を評価したとき |
| `holdoutRmsSimilarity` / `holdoutRmsAffine` | `holdout` を指定して検証に到達したとき |

### 非目標（Cycle 1）

- LOO（leave-one-out）validation（未指定 holdout は `validationSkipped`）
- 一般形 `criticalF`（df1≠2 の不完全ベータ）
- weight / robust fitting / 逆写像 RMS の高度化 / アンチメリディアン・極域

## 関連文書

- [CRS 推定ライブラリ群 仮仕様正本](../docs/superpowers/specs/2026-08-27-c1-crs-libs-provisional-spec.md) —
  本 package の観測契約・数値挙動が集約されている（**仮仕様**であり人間承認済みの確定仕様ではない）。
- [mock transformer 契約文書](../docs/superpowers/specs/2026-08-28-mock-transformer-contract.md) —
  `src/testkit/` が提供する mock adapter の契約。

上記リンクは**親リポジトリ（monorepo）を checkout したときにのみ解決する**。
本 repository を単体で clone した場合、`../docs/` は存在しない。

## ライセンス

MIT License です。[LICENSE](./LICENSE) を参照してください。

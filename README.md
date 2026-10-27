# Daedalus

[![CI](https://github.com/code4history/Daedalus/actions/workflows/test.yml/badge.svg)](https://github.com/code4history/Daedalus/actions/workflows/test.yml)

`@c4h/daedalus` fits world-file parameters for a known CRS.

- Input: GCPs plus a single CRS
- Output: `world_file_basic` and post-shear refinement
- Runtime: Node.js and browser. Browser support is described in three levels. **(1) Bundlability = verified**: Teiresias' `pnpm run verify:demo-bundle` (`scripts/verify-demo-browser-bundle.mjs`) scans the output chunks of the demo build and mechanically verifies that no Node-specific specifier remains and that Daedalus-derived code is actually present (it runs continuously from CI). **(2) Execution in a real browser = checked manually once**: the Teiresias demo was run in a real browser on 2026-08-29. A single manual check is not an automated test, so it does not guard against regressions. **(3) Continuous, automated browser execution on CI = not available yet** (planned; see [#4](https://github.com/code4history/Daedalus/issues/4)).
- Scope: fitting only, not CRS candidate lookup

日本語のREADMEは[こちら](./README.ja.md)。

## Demo

The demo is published on GitHub Pages: <https://code4history.dev/Daedalus/> (the fitting page is [`demo/worldfile-fit.html`](https://code4history.dev/Daedalus/demo/worldfile-fit.html)). `pnpm run dev` opens the same pages locally. Preset buttons load GCP sets that produce clearly different results:

- **Model**: a map with rotation and scale only is fitted as a similarity; the same points with a horizontal shear switch to affine, with F far above its critical value.
- **Point count**: 2 GCPs give only a `preview` answer; 3 GCPs are `adoptable` but affine is not evaluated; with 5 GCPs affine is evaluated and the F bars appear.
- **Layout**: only the nearly collinear set warns `nearCollinearSource` and skips affine.
- **A wrong point**: moving one GCP by about 75 m keeps the quality gate at `adoptable`; only its long residual arrow and the RMS reveal it. The quality gate is decided by the number of points and does not look at the size of the errors, so the demo says so next to it.
- **Dragging a point**: once you move a point by hand, the preset button is released and the expectation line says the input is no longer a preset.

## Installation

Requires Node.js >= 22 (or a browser through a bundler).

<!-- release-pinned:start -->
```sh
pnpm add @c4h/daedalus
```
<!-- release-pinned:end -->

## Public API

```ts
import { fitWorldFile } from '@c4h/daedalus';
const result = fitWorldFile(gcps, options);
```

Only `fitWorldFile` and the types are public. The affine / F-test helpers are package-internal and
are not exported from `src/index.ts`.

### Types

| Name | What it describes |
|---|---|
| `GcpPair` | One ground control point: `pixel` `[u, v]` and `geo` `[X, Y]`. |
| `GeoBasis` | How `geo` is expressed: `{ kind: 'lonlat_deg', axisOrder: 'lon-lat' }` or `{ kind: 'planar_xy', axisOrder: 'xy', unit: 'm' \| 'ft' }`. |
| `FitOptions` | Options of `fitWorldFile` (below). |
| `FitResult` | The return value (see the observation contract below). |
| `WorldFile` | The six world-file parameters `xScale`, `xSkew`, `xOrigin`, `ySkew`, `yScale`, `yOrigin`. |
| `QualityGate` | `'adoptable' \| 'preview' \| 'unusable'`. |
| `FitStatus` | `'ok' \| 'ok_with_warnings' \| 'insufficient' \| 'failed'`. |
| `FitWarning` | `{ code: WarningCode; detail?: string }`. |
| `WarningCode` | The warning codes listed in "Warning codes and evaluation order". |
| `MaybePromise` | `MaybePromise<T> = T \| Promise<T>`, a helper type. |

### `FitOptions`

| option | default | valid range | out of range / non-finite |
|---|---|---|---|
| `geoBasis` | equivalent to `lonlat_deg` / `lon-lat` | `lonlat_deg`(`lon-lat`) / `planar_xy`(`xy`) | `axisOrder: 'lat-lon'` becomes `unusable` with `unsupportedAxisOrder` |
| `debug` | `false` | boolean | — |
| `collinearityThreshold` | `0.01` | closed interval `[0,1]` | normalized to the default (no warning is added) |
| `alpha` | `0.05` | **open** interval `(0,1)` | out of range including `0` / `1`, and non-finite values, are normalized to the default |
| `minRelativeImprovement` | `0.01` | closed interval `[0,1]` | normalized to the default |
| `normalizeEpsilonMeters` | `100.0` | positive real number | — |
| `holdout` | unspecified | `GcpPair[]` | a non-empty holdout containing even one non-finite pixel/geo value is an invalid input |

For `collinearityThreshold`, `0` is the endpoint that "skips only perfectly collinear inputs whose
eigenvalue ratio is exactly 0", and `1` is the explicit setting that "skips every finite eigenvalue ratio".
For `minRelativeImprovement`, `0` is the setting that decides adoption by the statistical gate alone,
and `1` is the setting that only allows complete elimination of the training SSE.

### Observation contract of the return value

| field | content |
|---|---|
| `status` | `ok_with_warnings` if there is at least one warning, `ok` if there are none. An invalid input gives `insufficient` |
| `qualityGate` | `preview` for n=2, `unusable` for an invalid input, `adoptable` otherwise |
| `worldFile` | the selected model (affine when affine is adopted, similarity when it is not). `null` for an invalid input |
| `similarityOnly` | `false` only when affine is adopted |
| `rmsMeters` | the per-point 2D distance RMS on the training side of the **selected model** = `sqrt(SSE / n)`. `null` for an invalid input |
| `rmsPixels` | the pixel-side RMS obtained by the inverse mapping of the selected model |
| `warnings` | the codes in the table below. For `affineRejectedNonImproving`, the reason for rejection is put in `detail` |
| `debug` | present only when `options.debug` is truthy (see below) |

### Warning codes and evaluation order

The conditions are evaluated from the top, and the first matching branch determines the result.

| # | condition | `similarityOnly` | worldFile | qualityGate | warnings |
|---|---|---|---|---|---|
| 0 | n<2 / non-finite pixel or geo in training or in a non-empty holdout / all training pixels identical / `L_geo < normalizeEpsilonMeters` / `axisOrder: 'lat-lon'` | `true` | `null` | `unusable` | empty (only axisOrder gives `unsupportedAxisOrder`) |
| 1 | n=2 | `true` | similarity | `preview` | `insufficientPointCount`, `affineSkippedInsufficientDof` |
| 2 | n=3,4 | `true` | similarity | `adoptable` | `affineSkippedInsufficientDof` (plus `nearCollinearSource` when collinear) |
| 3 | n>=5 and λ2/λ1 <= `collinearityThreshold` | `true` | similarity | `adoptable` | `nearCollinearSource`, `affineSkippedCollinear` |
| 4 | n>=5 and no affine solution / non-finite / negative improvement / similarity already fits exactly within numerical tolerance | `true` | similarity | `adoptable` | `affineRejectedNonImproving` (+ `validationSkipped`*) |
| 5 | n>=5 and the F gate does not hold | `true` | similarity | `adoptable` | `affineRejectedNonImproving` (+ `validationSkipped`*) |
| 6 | n>=5 and the relative improvement gate does not hold | `true` | similarity | `adoptable` | `affineRejectedNonImproving` (+ `validationSkipped`*) |
| 7 | n>=5 and the holdout RMS gets worse | `true` | similarity | `adoptable` | `affineRejectedNonImproving` (the holdout is described in `detail`) |
| 8 | n>=5 and every gate passes | `false` | affine | `adoptable` | `validationSkipped`* |

\* `validationSkipped` is always emitted when **affine evaluation is reached (n>=5 and not collinear) and
`holdout` is unspecified/empty**, regardless of whether affine is adopted. For n<5 and for the collinear
skip, holdout validation is never reached, so it is not emitted.

### The affine adoption gate

Similarity (4 parameters) is a constrained submodel of affine (6 parameters), so `df1 = 2` always holds
and the residual degrees of freedom of affine are `df2 = 2n-6`. Affine is adopted only when **both** of
the following hold.

1. **F gate**: `F > criticalF(alpha, 2, 2n-6)`, where `F = ((SSE4-SSE6)/2) / (SSE6/(2n-6))` and
   `criticalF(alpha, 2, df2) = (df2/2)·(alpha^(-2/df2) - 1)`
2. **Relative improvement gate**: `(SSE4-SSE6)/SSE4 >= minRelativeImprovement`

When `holdout` is specified, `holdoutRmsAffine <= holdoutRmsSimilarity` is required in addition.

**Numerical zero of the SSE** is judged with a tolerance rather than by strict comparison
("exact fit within numerical tolerance").

```
epsSSE = 1024 · Number.EPSILON² · Σ(X² + Y²)      (the sum is over the geo coordinates of the training GCPs)
Z(s)   = (s <= epsSSE)
```

- `Z(SSE4)`: similarity already fits exactly within the tolerance, so there is no room for improvement.
  F is not evaluated and affine is rejected (#4)
- `Z(SSE6)` and `¬Z(SSE4)`: the F gate is passed by treating `F = +Infinity`

`alpha = 0.05`, `minRelativeImprovement = 0.01` and the safety factor `1024` are not values calibrated
against real data; they are initial heuristics for suppressing overfitting.

### `debug` (only when `options.debug` is truthy)

| field | condition for presence |
|---|---|
| `sse` / `mse` | always (the training SSE of the **selected model** and `sse/n`) |
| `sseSimilarity` / `sseZeroTolerance` | when affine evaluation is reached (#4 to #8) |
| `sseAffine` | when affine could be computed |
| `fStatistic` / `criticalF` / `relativeImprovement` | when the F gate was evaluated |
| `holdoutRmsSimilarity` / `holdoutRmsAffine` | when `holdout` was specified and validation was reached |

### Non-goals

The following are not supported. They are candidates for a future release and are tracked in the
issues [#3](https://github.com/code4history/Daedalus/issues/3) (validation, weights, robust fitting, wide areas and more) and
[#4](https://github.com/code4history/Daedalus/issues/4) (browser execution on CI).

- LOO (leave-one-out) validation (an unspecified holdout gives `validationSkipped`)
- The general form of `criticalF` (the incomplete beta function for df1≠2)
- Weights / robust fitting / more advanced inverse-mapping RMS / antimeridian and polar regions
- Continuous, automated browser execution on CI (see "Runtime" above)

## Development

- `pnpm run dev`: open the demo locally
- `pnpm run test` / `pnpm run typecheck` / `pnpm run test:types`: tests, type check and the public type surface
- `pnpm run build`: build the package into `dist/`
- `pnpm run verify:demo`: build the GitHub Pages demo into `dist-demo/` and check it

For an install of this repository on its own (outside a larger pnpm workspace), copy the CI
settings first: `cp ci/pnpm-workspace.ci.yaml pnpm-workspace.yaml && pnpm install --frozen-lockfile`.
Do not commit the copied `pnpm-workspace.yaml`.

`pnpm publish` is guarded by `prepublishOnly` (test, typecheck, test:types, build and
verify:demo). Releases are published from GitHub Actions (`.github/workflows/publish.yml`).
Changes are listed in [CHANGELOG.md](./CHANGELOG.md).

## License

MIT License. See [LICENSE](./LICENSE).

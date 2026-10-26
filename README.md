# Daedalus

[![CI](https://github.com/code4history/Daedalus/actions/workflows/test.yml/badge.svg)](https://github.com/code4history/Daedalus/actions/workflows/test.yml)

`@c4h/daedalus` fits world-file parameters for a known CRS.

- Input: GCPs plus a single CRS
- Output: `world_file_basic` and post-shear refinement
- Runtime: Node.js and browser. Browser support is described in three levels. **(1) Bundlability = verified**: Teiresias' `pnpm run verify:demo-bundle` (`scripts/verify-demo-browser-bundle.mjs`) scans the output chunks of the demo build and mechanically verifies that no Node-specific specifier remains and that Daedalus-derived code is actually present (it runs continuously from CI). **(2) Execution in a real browser = checked manually once**: the Teiresias demo was run in a real browser on 2026-08-29. A single manual check is not an automated test, so it does not guard against regressions. **(3) Continuous, automated browser execution on CI = not available yet** (planned; see the [issue tracker](https://github.com/code4history/Daedalus/issues)).
- Scope: fitting only, not CRS candidate lookup

日本語のREADMEは[こちら](./README.ja.md)。

## Public API

```ts
import { fitWorldFile } from '@c4h/daedalus';
const result = fitWorldFile(gcps, options);
```

Only `fitWorldFile` and the types are public. The affine / F-test helpers are package-internal and
are not exported from `src/index.ts`.

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
[issue tracker](https://github.com/code4history/Daedalus/issues).

- LOO (leave-one-out) validation (an unspecified holdout gives `validationSkipped`)
- The general form of `criticalF` (the incomplete beta function for df1≠2)
- Weights / robust fitting / more advanced inverse-mapping RMS / antimeridian and polar regions
- Continuous, automated browser execution on CI (see "Runtime" above)

## License

MIT License. See [LICENSE](./LICENSE).

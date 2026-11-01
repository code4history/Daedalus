## 1. Specification
- [x] 1.1 Define `world_file_basic` fitting.
- [x] 1.2 Define post-selection shear refinement.
- [x] 1.3 Define residual metrics and helper contracts.

> Implemented.
> - 1.1: closed-form similarity (Helmert) fitting behind the public `fitWorldFile` (`src/fitting/similarity.ts`, `src/index.ts`).
>   Test: `tests/similarity.test.ts` "similarity closed-form Helmert fitting".
> - 1.2: affine (shear) refinement after selection, adopted only through the F gate and the relative improvement gate,
>   with optional holdout validation (`src/fitting/affine.ts`). Test: `tests/affine.test.ts`.
> - 1.3: `rmsMeters` / `rmsPixels`, the `debug` SSE and MSE, and the warning codes (`src/types.ts`).
>   Tests: `tests/affine.test.ts`, `tests/contract-freeze.test.ts`, `tests/api-smoke.test.ts`.

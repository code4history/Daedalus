import type { GcpPair, WorldFile } from '../types.js';

/**
 * m0-t2: 6 パラメータ affine 閉形式最小二乗と、採用 gate に使う統計 helper 群。
 *
 * 設計正本: docs/superpowers/specs/2026-08-28-m0-t2-maplat-v4-crs-libs-task-design.md v1.2
 *   §3.2  affine 閉形式最小二乗
 *   §3.4  F 検定・criticalF・数値的ゼロ許容 εSSE
 *   §3.5  二重 gate（F gate と相対改善 gate の AND）
 *
 * ここは package-internal である。`src/index.ts` からは公開しない
 * （公開 API は `fitWorldFile` と型のみ。設計 §3.2.1）。
 */

export type AffineFit = {
  worldFile: WorldFile;
  /** training SSE（設計 §3.4 の SSE 定義） */
  sse: number;
};

/**
 * WorldFile forward 写像による残差二乗和。
 *
 *   SSE = Σ_i [ (X_i - X̂_i)² + (Y_i - Ŷ_i)² ]
 *   X̂ = xScale·u + xSkew·v + xOrigin ,  Ŷ = ySkew·u + yScale·v + yOrigin
 *
 * training SSE と holdout の残差計算の両方で使う（設計 §3.4 / §3.6）。
 */
export function forwardSse(worldFile: WorldFile, gcps: readonly GcpPair[]): number {
  let sse = 0;
  for (let i = 0; i < gcps.length; i++) {
    const { pixel, geo } = gcps[i];
    const X = worldFile.xScale * pixel[0] + worldFile.xSkew * pixel[1] + worldFile.xOrigin;
    const Y = worldFile.ySkew * pixel[0] + worldFile.yScale * pixel[1] + worldFile.yOrigin;
    const dx = geo[0] - X;
    const dy = geo[1] - Y;
    sse += dx * dx + dy * dy;
  }
  return sse;
}

/**
 * 6 パラメータ affine の閉形式最小二乗（設計 §3.2）。
 *
 * 重心化 pre-conditioning を行い、X 系・Y 系を独立な 2×2 正規方程式として解く。
 * `det M === 0`（共分散行列が特異 = 完全共線）または解／SSE に非有限値が出た場合は `null`。
 *
 * 注: ここの `=== 0` は **共分散行列の特異判定**であって SSE のゼロ比較ではない。
 *     SSE の「ゼロ」判定は呼出側が設計 §3.4 の数値許容 εSSE で行い、厳密比較を使わない。
 */
export function fitAffine(gcps: readonly GcpPair[]): AffineFit | null {
  const n = gcps.length;
  if (n < 3) return null;

  let sumU = 0;
  let sumV = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    const { pixel, geo } = gcps[i];
    sumU += pixel[0];
    sumV += pixel[1];
    sumX += geo[0];
    sumY += geo[1];
  }
  const uBar = sumU / n;
  const vBar = sumV / n;
  const xBar = sumX / n;
  const yBar = sumY / n;

  let Suu = 0;
  let Svv = 0;
  let Suv = 0;
  let SuX = 0;
  let SvX = 0;
  let SuY = 0;
  let SvY = 0;
  for (let i = 0; i < n; i++) {
    const { pixel, geo } = gcps[i];
    const uPrime = pixel[0] - uBar;
    const vPrime = pixel[1] - vBar;
    const xPrime = geo[0] - xBar;
    const yPrime = geo[1] - yBar;

    Suu += uPrime * uPrime;
    Svv += vPrime * vPrime;
    Suv += uPrime * vPrime;
    SuX += uPrime * xPrime;
    SvX += vPrime * xPrime;
    SuY += uPrime * yPrime;
    SvY += vPrime * yPrime;
  }

  const detM = Suu * Svv - Suv * Suv;
  if (!Number.isFinite(detM) || detM === 0) return null;

  const a = (Svv * SuX - Suv * SvX) / detM;
  const b = (Suu * SvX - Suv * SuX) / detM;
  const d = (Svv * SuY - Suv * SvY) / detM;
  const e = (Suu * SvY - Suv * SuY) / detM;
  const c = xBar - a * uBar - b * vBar;
  const f = yBar - d * uBar - e * vBar;

  if (
    !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) ||
    !Number.isFinite(d) || !Number.isFinite(e) || !Number.isFinite(f)
  ) {
    return null;
  }

  const worldFile: WorldFile = {
    xScale: a,
    xSkew: b,
    xOrigin: c,
    ySkew: d,
    yScale: e,
    yOrigin: f,
  };

  const sse = forwardSse(worldFile, gcps);
  if (!Number.isFinite(sse)) return null;

  return { worldFile, sse };
}

/**
 * F(df1, df2) 分布の上側 alpha 点（設計 §3.4）。
 *
 * 本タスクでは df1 は常に 2 なので、一般形（不完全ベータ）は実装せず閉形式を用いる。
 *
 *   P(F>f) = (df2 / (2f + df2))^(df2/2)
 *   ⇒ criticalF(alpha, 2, df2) = (df2/2) · (alpha^(-2/df2) - 1)
 *
 * 失敗契約: `df1 !== 2`、`df2` が非有限または `<= 0`、`alpha` が非有限または
 * 開区間 (0,1) の外なら **NaN を返す**（throw しない）。
 */
export function criticalF(alpha: number, df1: number, df2: number): number {
  if (df1 !== 2) return Number.NaN;
  if (!Number.isFinite(df2) || df2 <= 0) return Number.NaN;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) return Number.NaN;
  return (df2 / 2) * (Math.pow(alpha, -2 / df2) - 1);
}

/**
 * F 統計量（設計 §3.4）。df1 = 2 固定。
 *
 *   F = ((SSE4 - SSE6) / 2) / (SSE6 / df2)
 *
 * `df2` が非有限または `<= 0` なら NaN。
 * Z(SSE6)（数値的ゼロ）の場合に +Infinity とする判断は呼出側が行う（設計 §3.4）。
 */
export function fStatistic(sseSimilarity: number, sseAffine: number, df2: number): number {
  if (!Number.isFinite(df2) || df2 <= 0) return Number.NaN;
  return ((sseSimilarity - sseAffine) / 2) / (sseAffine / df2);
}

/**
 * 相対改善（設計 §3.5）。
 *
 *   (SSE4 - SSE6) / SSE4
 *
 * SSE4 が正でない場合（Z(SSE4) の極限を含む）は 0 とする。
 * 通常経路では呼出側が Z(SSE4) を先に弾くため、この防御は到達しない。
 */
export function relativeImprovement(sseSimilarity: number, sseAffine: number): number {
  if (!(sseSimilarity > 0)) return 0;
  return (sseSimilarity - sseAffine) / sseSimilarity;
}

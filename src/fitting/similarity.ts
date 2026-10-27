import type { FitOptions, FitResult, GcpPair, FitWarning, WarningCode, WorldFile } from '../types.js';
import { criticalF, fStatistic, fitAffine, forwardSse, relativeImprovement } from './affine.js';

export { type FitOptions, type FitResult, type FitWarning, type WarningCode };

/** F gate の有意水準（開区間 (0,1)） */
const DEFAULT_ALPHA = 0.05;
/** 相対改善 gate の下限（閉区間 [0,1]） */
const DEFAULT_MIN_RELATIVE_IMPROVEMENT = 0.01;
/** 共分散固有値比の共線判定閾値（閉区間 [0,1]） */
const DEFAULT_COLLINEARITY_THRESHOLD = 0.01;

/** 閉区間 [0,1] を有効範囲とする option の正規化。範囲外・非有限は既定値へ落とし warning は足さない。 */
function normalizeClosedUnit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0 || value > 1) return fallback;
  return value;
}

/** 開区間 (0,1) を有効範囲とする option の正規化。0 / 1 を含む範囲外と非有限は既定値へ落とす。 */
function normalizeOpenUnit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value <= 0 || value >= 1) return fallback;
  return value;
}

/** affine 診断値（`FitResult.debug` のうち sse / mse を除いた optional 部分） */
type AffineDebug = Omit<NonNullable<FitResult['debug']>, 'sse' | 'mse'>;

/**
 * 選択モデルの逆写像による rmsPixels（affine 採用時）。
 * similarity（Helmert）の逆写像方式を一般の 2×2 affine へ拡張したもので、
 * similarity（xScale=yScale, xSkew=-ySkew）を代入すると similarity の式に一致する。
 */
function affineRmsPixels(wf: WorldFile, gcps: readonly GcpPair[]): number {
  const det = wf.xScale * wf.yScale - wf.xSkew * wf.ySkew;
  if (!Number.isFinite(det) || det === 0) return 0;
  let sumSqErrPixels = 0;
  for (let i = 0; i < gcps.length; i++) {
    const { pixel, geo } = gcps[i];
    const dX = geo[0] - wf.xOrigin;
    const dY = geo[1] - wf.yOrigin;
    const uTilde = (wf.yScale * dX - wf.xSkew * dY) / det;
    const vTilde = (wf.xScale * dY - wf.ySkew * dX) / det;
    const du = pixel[0] - uTilde;
    const dv = pixel[1] - vTilde;
    sumSqErrPixels += du * du + dv * dv;
  }
  return Math.sqrt(sumSqErrPixels / gcps.length);
}

/** holdout の 1 点あたり 2D 距離 RMS */
function holdoutRms(wf: WorldFile, holdout: readonly GcpPair[]): number {
  return Math.sqrt(forwardSse(wf, holdout) / holdout.length);
}

export function fitWorldFile(
  gcps: readonly GcpPair[],
  opts?: FitOptions
): FitResult {
  const n = gcps.length;

  // 1. Basic unusable conditions
  if (n < 2) {
    return {
      status: 'insufficient',
      qualityGate: 'unusable',
      worldFile: null,
      similarityOnly: true,
      rmsMeters: null,
      warnings: [],
    };
  }

  // 1b. 非空 holdout の非有限 pixel / geo は入力不正（分岐 #0）。
  //     training fit より先に検査し、非有限値を RMS へ伝播させない。新規 WarningCode は作らない。
  const holdout: readonly GcpPair[] = opts?.holdout ?? [];
  for (let i = 0; i < holdout.length; i++) {
    const { pixel, geo } = holdout[i];
    if (
      !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1]) ||
      !Number.isFinite(geo[0]) || !Number.isFinite(geo[1])
    ) {
      return {
        status: 'insufficient',
        qualityGate: 'unusable',
        worldFile: null,
        similarityOnly: true,
        rmsMeters: null,
        warnings: [],
      };
    }
  }

  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (let i = 0; i < n; i++) {
    const { geo } = gcps[i];
    if (!Number.isFinite(geo[0]) || !Number.isFinite(geo[1])) {
       return {
        status: 'insufficient',
        qualityGate: 'unusable',
        worldFile: null,
        similarityOnly: true,
        rmsMeters: null,
        warnings: [],
      };
    }
    if (geo[0] < minLon) minLon = geo[0];
    if (geo[0] > maxLon) maxLon = geo[0];
    if (geo[1] < minLat) minLat = geo[1];
    if (geo[1] > maxLat) maxLat = geo[1];
  }

  // check unsupported axis order
  if (opts?.geoBasis && 'axisOrder' in opts.geoBasis) {
     if ((opts.geoBasis as any).axisOrder === 'lat-lon') {
       return {
          status: 'insufficient',
          qualityGate: 'unusable',
          worldFile: null,
          similarityOnly: true,
          rmsMeters: null,
          warnings: [{code: 'unsupportedAxisOrder'}],
        };
     }
  }

  // L_geo approximate
  let L_geo = 0;
  if (!opts?.geoBasis || opts.geoBasis.kind === 'lonlat_deg') {
     const latCenter = (minLat + maxLat) / 2;
     const dx = (maxLon - minLon) * 111320 * Math.cos(latCenter * Math.PI / 180);
     const dy = (maxLat - minLat) * 111320;
     L_geo = Math.sqrt(dx * dx + dy * dy);
  } else {
     L_geo = Math.sqrt((maxLon - minLon)**2 + (maxLat - minLat)**2);
  }

  const epsilon = opts?.normalizeEpsilonMeters ?? 100.0;
  if (L_geo < epsilon) {
     return {
      status: 'insufficient',
      qualityGate: 'unusable',
      worldFile: null,
      similarityOnly: true,
      rmsMeters: null,
      warnings: [],
    };
  }

  let sumU = 0, sumV = 0, sumX = 0, sumY = 0;
  // Σ(X²+Y²)（training geo のみ）。εSSE の材料。
  // 総和順序は「training GCP を index 昇順に走査し、各点で X²+Y² を加える」に固定する。
  // tests/affine.test.ts はこの順序で再計算し、厳密一致で照合する（MIN-R3-1 の選択機構）。
  let sumGeoSq = 0;
  for (let i = 0; i < n; i++) {
    const { pixel, geo } = gcps[i];
    if (!Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) {
        return {
          status: 'insufficient',
          qualityGate: 'unusable',
          worldFile: null,
          similarityOnly: true,
          rmsMeters: null,
          warnings: [],
        };
    }
    sumU += pixel[0];
    sumV += pixel[1];
    sumX += geo[0];
    sumY += geo[1];
    sumGeoSq += geo[0] * geo[0] + geo[1] * geo[1];
  }

  const uBar = sumU / n;
  const vBar = sumV / n;
  const xBar = sumX / n;
  const yBar = sumY / n;

  let D = 0;
  let sumUPrimeXPrime = 0;
  let sumVPrimeYPrime = 0;
  let sumUPrimeYPrime = 0;
  let sumVPrimeXPrime = 0;

  let Suu = 0, Svv = 0, Suv = 0;

  for (let i = 0; i < n; i++) {
    const { pixel, geo } = gcps[i];
    const uPrime = pixel[0] - uBar;
    const vPrime = pixel[1] - vBar;
    const xPrime = geo[0] - xBar;
    const yPrime = geo[1] - yBar;

    D += uPrime * uPrime + vPrime * vPrime;

    sumUPrimeXPrime += uPrime * xPrime;
    sumVPrimeYPrime += vPrime * yPrime;
    sumUPrimeYPrime += uPrime * yPrime;
    sumVPrimeXPrime += vPrime * xPrime;

    Suu += uPrime * uPrime;
    Svv += vPrime * vPrime;
    Suv += uPrime * vPrime;
  }

  // 2. D = 0 condition (all pixels are same)
  if (D === 0) {
    return {
      status: 'insufficient',
      qualityGate: 'unusable',
      worldFile: null,
      similarityOnly: true,
      rmsMeters: null,
      warnings: [],
    };
  }

  const warnings: FitWarning[] = [];

  // 3. n=2 preview condition
  if (n === 2) {
      warnings.push({code: 'insufficientPointCount'});
  }

  // 4. Near Collinear detection (n >= 3)
  // 固有値分解は similarity パスと affine パスで共用する（二重計算しない）
  let nearCollinear = false;
  if (n >= 3) {
      const suu = Suu / n;
      const svv = Svv / n;
      const suv = Suv / n;

      const trace = suu + svv;
      const det = suu * svv - suv * suv;
      const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * det));

      const lambda1 = (trace + discriminant) / 2;
      const lambda2 = (trace - discriminant) / 2;

      const threshold = normalizeClosedUnit(opts?.collinearityThreshold, DEFAULT_COLLINEARITY_THRESHOLD);

      // We check lambda1 > 0 to avoid division by zero, though D > 0 should ensure trace > 0
      if (lambda1 > 0 && (lambda2 / lambda1) <= threshold) {
          nearCollinear = true;
          warnings.push({code: 'nearCollinearSource'});
      }
  }

  // 5. Helmert calculation
  const a = (sumUPrimeXPrime + sumVPrimeYPrime) / D;
  const b = (sumUPrimeYPrime - sumVPrimeXPrime) / D;

  const tx = xBar - a * uBar + b * vBar;
  const ty = yBar - b * uBar - a * vBar;

  const worldFile = {
    xScale: a,
    xSkew: -b,
    xOrigin: tx,
    ySkew: b,
    yScale: a,
    yOrigin: ty,
  };

  let sse = 0;
  for(let i=0; i<n; i++) {
      const u = gcps[i].pixel[0];
      const v = gcps[i].pixel[1];
      const X = worldFile.xScale * u + worldFile.xSkew * v + worldFile.xOrigin;
      const Y = worldFile.ySkew * u + worldFile.yScale * v + worldFile.yOrigin;
      const dx = gcps[i].geo[0] - X;
      const dy = gcps[i].geo[1] - Y;
      sse += dx*dx + dy*dy;
  }
  // The spec says rmsPixels. But dx, dy are in geo coordinates...
  // Ah, looking at 3.2.4 "rmsPixels" formulation:
  // rmsPixels = \sqrt{\frac{1}{n}\sum_i\left((u_i - \tilde{u}_i)^2 + (v_i - \tilde{v}_i)^2\right)}
  // Wait, I need inverse transform to calculate rmsPixels correctly?
  // Let's implement inverse mapping for rmsPixels.
  let sumSqErrPixels = 0;
  const scale2 = a*a + b*b;
  if (scale2 > 0) {
      for (let i = 0; i < n; i++) {
         const { pixel, geo } = gcps[i];
         const X = geo[0];
         const Y = geo[1];
         // Inverse Helmert
         const uTilde = (a * (X - tx) + b * (Y - ty)) / scale2;
         const vTilde = (a * (Y - ty) - b * (X - tx)) / scale2;
         const du = pixel[0] - uTilde;
         const dv = pixel[1] - vTilde;
         sumSqErrPixels += du*du + dv*dv;
      }
  }
  const rmsPixels = scale2 > 0 ? Math.sqrt(sumSqErrPixels / n) : 0;

  // 6. affine 判定（分岐 #1〜#8 を番号順に上から評価する）
  const alpha = normalizeOpenUnit(opts?.alpha, DEFAULT_ALPHA);
  const minRelativeImprovement = normalizeClosedUnit(
    opts?.minRelativeImprovement,
    DEFAULT_MIN_RELATIVE_IMPROVEMENT
  );

  let similarityOnly = true;
  let selectedWorldFile: WorldFile = worldFile;
  let selectedSse = sse;
  let selectedRmsPixels = rmsPixels;
  const affineDebug: AffineDebug = {};

  if (n < 5) {
    // #1 / #2: df2 = 2n-6 <= 0 ∴ affine は評価対象外
    warnings.push({ code: 'affineSkippedInsufficientDof' });
  } else if (nearCollinear) {
    // #3: 共線 ∴ affine を計算しない（det M のゼロ除算を事前に防ぐ）
    warnings.push({ code: 'affineSkippedCollinear' });
  } else {
    // #4〜#8: affine 評価に到達する
    // εSSE = 1024 · Number.EPSILON² · Σ(X²+Y²)。
    // 以降の SSE の「ゼロ」判定はすべて Z(s) := (s <= sseZeroTolerance) を使い、厳密比較はしない。
    const sseZeroTolerance = 1024 * Number.EPSILON * Number.EPSILON * sumGeoSq;
    affineDebug.sseSimilarity = sse;
    affineDebug.sseZeroTolerance = sseZeroTolerance;

    const affine = fitAffine(gcps);
    let rejectDetail: string | null = null;

    if (affine === null) {
      // #4: 解なし / 非有限
      rejectDetail = 'affine solution unavailable (singular normal equations or non-finite result)';
    } else {
      affineDebug.sseAffine = affine.sse;

      if (sse <= sseZeroTolerance) {
        // #4: Z(SSE4)。similarity が既に数値許容内で厳密適合 ∴ 改善余地なし。F は評価しない
        rejectDetail =
          `similarity already fits within numerical tolerance (SSE4=${sse} <= epsSSE=${sseZeroTolerance})`;
      } else if (affine.sse > sse) {
        // #4: 負の改善（数値誤差でのみ起こり得る）
        rejectDetail = `affine SSE is not smaller than similarity SSE (SSE6=${affine.sse} > SSE4=${sse})`;
      } else {
        const df2 = 2 * n - 6;
        // Z(SSE6) かつ ¬Z(SSE4) なら F = +Infinity
        const fValue = affine.sse <= sseZeroTolerance
          ? Number.POSITIVE_INFINITY
          : fStatistic(sse, affine.sse, df2);
        const fThreshold = criticalF(alpha, 2, df2);
        const improvement = relativeImprovement(sse, affine.sse);
        affineDebug.fStatistic = fValue;
        affineDebug.criticalF = fThreshold;
        affineDebug.relativeImprovement = improvement;

        if (!(fValue > fThreshold)) {
          // #5: F gate 不成立
          rejectDetail = `F gate not passed (F=${fValue} <= criticalF=${fThreshold})`;
        } else if (!(improvement >= minRelativeImprovement)) {
          // #6: 相対改善 gate 不成立
          rejectDetail =
            `relative improvement below minRelativeImprovement (${improvement} < ${minRelativeImprovement})`;
        } else if (holdout.length > 0) {
          const holdoutRmsSimilarity = holdoutRms(worldFile, holdout);
          const holdoutRmsAffine = holdoutRms(affine.worldFile, holdout);
          affineDebug.holdoutRmsSimilarity = holdoutRmsSimilarity;
          affineDebug.holdoutRmsAffine = holdoutRmsAffine;
          if (holdoutRmsAffine > holdoutRmsSimilarity) {
            // #7: holdout 悪化
            rejectDetail =
              `holdout RMS worsened (affine=${holdoutRmsAffine} > similarity=${holdoutRmsSimilarity})`;
          }
        }
      }
    }

    if (rejectDetail !== null) {
      warnings.push({ code: 'affineRejectedNonImproving', detail: rejectDetail });
    } else {
      // #8: 全 gate 通過
      similarityOnly = false;
      selectedWorldFile = affine!.worldFile;
      selectedSse = affine!.sse;
      selectedRmsPixels = affineRmsPixels(affine!.worldFile, gcps);
    }

    // ※ affine 評価に到達し holdout 未指定 / 空なら、採用可否にかかわらず必ず発出する
    if (holdout.length === 0) {
      warnings.push({ code: 'validationSkipped' });
    }
  }

  // 7. status and qualityGate
  const qualityGate = n === 2 ? 'preview' : 'adoptable';
  const status = warnings.length > 0 ? 'ok_with_warnings' : 'ok';

  return {
      status,
      qualityGate,
      worldFile: selectedWorldFile,
      similarityOnly,
      rmsMeters: Math.sqrt(selectedSse / n),
      rmsPixels: selectedRmsPixels,
      warnings,
      ...(opts?.debug ? { debug: { sse: selectedSse, mse: selectedSse/n, ...affineDebug } } : {})
  };
}

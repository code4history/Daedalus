import type { FitOptions, FitResult, GcpPair, FitWarning, WarningCode } from '../types.js';

export { type FitOptions, type FitResult, type FitWarning, type WarningCode };
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
  if (n >= 3) {
      const suu = Suu / n;
      const svv = Svv / n;
      const suv = Suv / n;

      const trace = suu + svv;
      const det = suu * svv - suv * suv;
      const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * det));

      const lambda1 = (trace + discriminant) / 2;
      const lambda2 = (trace - discriminant) / 2;

      const threshold = opts?.collinearityThreshold ?? 0.01;

      // We check lambda1 > 0 to avoid division by zero, though D > 0 should ensure trace > 0
      if (lambda1 > 0 && (lambda2 / lambda1) <= threshold) {
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

  // 6. status and qualityGate
  const qualityGate = n === 2 ? 'preview' : 'adoptable';
  const status = warnings.length > 0 ? 'ok_with_warnings' : 'ok';

  return {
      status,
      qualityGate,
      worldFile,
      similarityOnly: true,
      rmsMeters: null,
      rmsPixels,
      warnings,
      ...(opts?.debug ? { debug: { sse, mse: sse/n } } : {})
  };
}

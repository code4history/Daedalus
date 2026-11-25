/**
 * 使えない当てはめ結果を採用可として返さないこと（SR-DEC26-F-6）。
 *
 * - 返す world file の 6 値・RMS が有限で、線形部の行列式が 0 でないときだけ worldFile を返す。
 * - `normalizeEpsilonMeters` は正の有限値だけを受け、それ以外は既定値 100 へ落とす。
 * - 正当な入力（小さい・大きい縮尺、既定より小さい epsilon）は今までどおり通る。
 */
import { describe, expect, test } from 'vitest';

import { fitWorldFile } from '../src/fitting/similarity.js';
import type { FitResult, GcpPair } from '../src/types.js';

const planar = { kind: 'planar_xy', axisOrder: 'xy', unit: 'm' } as const;

function expectUnusable(result: FitResult): void {
  expect(result.qualityGate).toBe('unusable');
  expect(result.status).toBe('insufficient');
  expect(result.worldFile).toBeNull();
  expect(result.rmsMeters).toBeNull();
  expect(result.similarityOnly).toBe(true);
}

function expectFiniteAdoptable(result: FitResult): void {
  expect(result.qualityGate).toBe('adoptable');
  expect(result.worldFile).not.toBeNull();
  const wf = result.worldFile!;
  for (const value of Object.values(wf)) expect(Number.isFinite(value)).toBe(true);
  expect(wf.xScale * wf.yScale - wf.xSkew * wf.ySkew).not.toBe(0);
  expect(Number.isFinite(result.rmsMeters)).toBe(true);
  expect(Number.isFinite(result.rmsPixels)).toBe(true);
}

/** pixel → geo が (u, v) → (s·u + tx, −s·v + ty) の 5 点（北が上の地図）。 */
function northUp(scale: number, tx: number, ty: number, pixelSize = 1000): GcpPair[] {
  const pixels: Array<[number, number]> = [
    [0, 0],
    [pixelSize, 0],
    [0, pixelSize],
    [pixelSize, pixelSize],
    [pixelSize * 0.3, pixelSize * 0.7],
  ];
  return pixels.map(([u, v]) => ({ pixel: [u, v] as const, geo: [scale * u + tx, -scale * v + ty] as const }));
}

describe('退化・非有限の結果を採用しない', () => {
  test('桁の大きすぎる pixel（3 点）は unusable', () => {
    const gcps: GcpPair[] = [
      { pixel: [0, 0], geo: [0, 0] },
      { pixel: [1e200, 0], geo: [1000, 0] },
      { pixel: [0, 1e200], geo: [0, 1000] },
    ];
    expectUnusable(fitWorldFile(gcps, { geoBasis: planar }));
  });

  test('桁の大きすぎる geo（3 点）は unusable', () => {
    const gcps: GcpPair[] = [
      { pixel: [0, 0], geo: [0, 0] },
      { pixel: [1000, 0], geo: [1e200, 0] },
      { pixel: [0, 1000], geo: [0, 1e200] },
    ];
    expectUnusable(fitWorldFile(gcps, { geoBasis: planar }));
  });

  test('桁の大きすぎる入力は n=2（preview）と n>=5（affine の評価）でも unusable', () => {
    expectUnusable(
      fitWorldFile(
        [
          { pixel: [0, 0], geo: [0, 0] },
          { pixel: [1e200, 1e200], geo: [1000, 1000] },
        ],
        { geoBasis: planar },
      ),
    );
    expectUnusable(fitWorldFile(northUp(1e200, 0, 0), { geoBasis: planar }));
    expectUnusable(fitWorldFile(northUp(1, 0, 0, 1e200), { geoBasis: planar }));
  });

  test.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'normalizeEpsilonMeters が %s なら既定値 100 で判定し、geo が 1 点に重なる入力は unusable',
    (epsilon) => {
      const gcps: GcpPair[] = [
        { pixel: [0, 0], geo: [5000, 5000] },
        { pixel: [1000, 0], geo: [5000, 5000] },
        { pixel: [0, 1000], geo: [5000, 5000] },
      ];
      expectUnusable(fitWorldFile(gcps, { geoBasis: planar, normalizeEpsilonMeters: epsilon }));
    },
  );

  test.each([Number.NaN, -1, 0, Number.POSITIVE_INFINITY])(
    'normalizeEpsilonMeters が %s なら既定値 100 と同じ結果（広がり 50 m は unusable・500 m は adoptable）',
    (epsilon) => {
      const options = { geoBasis: planar, normalizeEpsilonMeters: epsilon };
      expectUnusable(fitWorldFile(northUp(0.03, 5000, 5000), options));
      const wide = fitWorldFile(northUp(0.35, 5000, 5000), options);
      expect(wide).toEqual(fitWorldFile(northUp(0.35, 5000, 5000), { geoBasis: planar }));
      expectFiniteAdoptable(wide);
    },
  );
});

describe('正当な入力は今までどおり通る', () => {
  test('既定より小さい正の epsilon は効く（広がり 50 m を epsilon 10 で採用）', () => {
    const result = fitWorldFile(northUp(0.03, 5000, 5000), { geoBasis: planar, normalizeEpsilonMeters: 10 });
    expectFiniteAdoptable(result);
    expect(result.worldFile!.xScale).toBeCloseTo(0.03, 9);
    expect(result.worldFile!.yScale).toBeCloseTo(-0.03, 9);
  });

  test('経緯度の小さい縮尺（1 pixel が 1e-6 度）', () => {
    const gcps = northUp(1e-6, 139.7, 35.7, 4000);
    const result = fitWorldFile(gcps, { normalizeEpsilonMeters: 1 });
    expectFiniteAdoptable(result);
    expect(result.worldFile!.xScale).toBeCloseTo(1e-6, 12);
  });

  test('平面直角の大きい座標と大きい画像（座標 1e7 m・画像 1e5 pixel）', () => {
    const result = fitWorldFile(northUp(250, 1e7, 1e7, 1e5), { geoBasis: planar });
    expectFiniteAdoptable(result);
    expect(result.worldFile!.xScale).toBeCloseTo(250, 6);
  });

  test('affine を採用する入力（x と y で縮尺が違う）', () => {
    const pixels: Array<[number, number]> = [
      [0, 0], [1000, 0], [0, 1000], [1000, 1000], [300, 700], [800, 200], [500, 500],
    ];
    const gcps: GcpPair[] = pixels.map(([u, v]) => ({ pixel: [u, v], geo: [2 * u + 100, -3 * v + 9000] }));
    const result = fitWorldFile(gcps, { geoBasis: planar });
    expectFiniteAdoptable(result);
    expect(result.similarityOnly).toBe(false);
    expect(result.worldFile!.xScale).toBeCloseTo(2, 9);
    expect(result.worldFile!.yScale).toBeCloseTo(-3, 9);
  });
});

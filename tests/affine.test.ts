import { describe, test, expect } from 'vitest';
import { fitWorldFile } from '../src/fitting/similarity.js';
import { criticalF, fStatistic, fitAffine, relativeImprovement } from '../src/fitting/affine.js';
import type { GcpPair } from '../src/types.js';

/**
 * m0-t2 / AC-m0-4・AC-m0-5 のテスト。
 * 設計正本: docs/superpowers/specs/2026-08-28-m0-t2-maplat-v4-crs-libs-task-design.md v1.2
 *
 * fixture はすべて決定的（乱数なし）で、tolerance と点数をテスト名へ明記する。
 * 厳密値依存テストの成立機構（設計 §4.4）:
 *   - SSE 系の「ゼロ」判定は §3.4 の数値許容 εSSE で成立させる（fixture 座標の2進表現に依存しない）
 *   - collinearityThreshold=0 の完全共線 skip だけは許容を持たない厳密比較なので、
 *     pixel を整数座標に制約して det M と λ2 を厳密 0 にする
 */

// ---------------------------------------------------------------------------
// fixture 群
// ---------------------------------------------------------------------------

/**
 * FX_EXACT_AFFINE: 既知の 6 パラメータ affine 写像に厳密に載る 5 点。
 *   X = 2u + 0.5v + 100 、 Y = -0.25u + 3v + 200
 * similarity では表現できない（xScale≠yScale かつ xSkew≠-ySkew）。
 * 実測: SSE4 = 0.9417613636363448 、SSE6 = 0 、εSSE = 1.3017069527698817e-23
 * ∴ Z(SSE6) ∧ ¬Z(SSE4) → F = +Infinity で採用（設計 §3.4 / §5-6）。
 */
const FX_EXACT_AFFINE: readonly GcpPair[] = [
  { pixel: [0, 0] as const, geo: [100, 200] as const },
  { pixel: [1, 0] as const, geo: [102, 199.75] as const },
  { pixel: [0, 1] as const, geo: [100.5, 203] as const },
  { pixel: [1, 1] as const, geo: [102.5, 202.75] as const },
  { pixel: [2, 3] as const, geo: [105.5, 208.5] as const },
];

/**
 * FX_GATE_PASS: F gate も相対改善 gate も既定値で通過する 5 点。
 * 実測: SSE4 = 0.025227272727271734 、SSE6 = 0.004102564102564073
 *       F = 10.298295454545059 、relativeImprovement = 0.8373758373758321
 * criticalF(0.05,2,4) = 6.944271909999159 → 通過 / criticalF(0.01,2,4) = 18 → 不通過
 * ∴ alpha の効きと相対改善 gate の効きを 1 つの fixture で切り分けられる。
 */
const FX_GATE_PASS: readonly GcpPair[] = [
  { pixel: [0, 0] as const, geo: [100, -50] as const },
  { pixel: [1, 0] as const, geo: [101.5, -49.7] as const },
  { pixel: [0, 1] as const, geo: [99.8, -48.5] as const },
  { pixel: [1, 1] as const, geo: [101.3, -48.2] as const },
  { pixel: [2, 3] as const, geo: [102.6, -44.9] as const },
];

/**
 * FX_F_FAIL: 相対改善は 0.5656573134917598 と大きいが F = 2.6046590909089864 で
 * criticalF(0.05,2,4) = 6.944271909999159 に届かない 5 点。F gate 単独の不成立を切り出す。
 */
const FX_F_FAIL: readonly GcpPair[] = [
  { pixel: [0, 0] as const, geo: [100, -50] as const },
  { pixel: [1, 0] as const, geo: [101.5, -49.7] as const },
  { pixel: [0, 1] as const, geo: [99.8, -48.5] as const },
  { pixel: [1, 1] as const, geo: [101.3, -48.2] as const },
  { pixel: [2, 3] as const, geo: [103.4, -44.9] as const },
];

/**
 * FX_SIMILARITY_EXACT: AC-m0-1 と同型（a=1.5, b=0.3, tx=100, ty=-50 の厳密 Helmert）。
 * 実測: SSE4 = 1.0097419586828951e-28 ≤ εSSE = 3.1589666105778918e-24 ∴ Z(SSE4) 成立。
 */
const FX_SIMILARITY_EXACT: readonly GcpPair[] = [
  { pixel: [0, 0] as const, geo: [100.0, -50.0] as const },
  { pixel: [1, 0] as const, geo: [101.5, -49.7] as const },
  { pixel: [0, 1] as const, geo: [99.7, -48.5] as const },
  { pixel: [1, 1] as const, geo: [101.2, -48.2] as const },
  { pixel: [2, 3] as const, geo: [102.1, -44.9] as const },
];

/**
 * FX_COLLINEAR5: pixel が完全共線（整数座標のため det M と λ2 が厳密 0）。
 * collinearityThreshold=0 でも skip されることの検証に使う（設計 §4.4 の fixture 制約）。
 */
const FX_COLLINEAR5: readonly GcpPair[] = [
  { pixel: [0, 0] as const, geo: [100, -50] as const },
  { pixel: [1, 1] as const, geo: [101.5, -48.5] as const },
  { pixel: [2, 2] as const, geo: [103, -47] as const },
  { pixel: [3, 3] as const, geo: [104.5, -45.5] as const },
  { pixel: [4, 4] as const, geo: [106, -44] as const },
];

const FX_N4: readonly GcpPair[] = FX_SIMILARITY_EXACT.slice(0, 4);
const FX_N3: readonly GcpPair[] = FX_SIMILARITY_EXACT.slice(0, 3);

const codes = (r: ReturnType<typeof fitWorldFile>): string[] => r.warnings.map((w) => w.code);

/**
 * εSSE の独立再計算（MIN-R3-1 で選んだ機構: 実装と同一の総和順序で再計算し厳密一致で照合する）。
 * 実装（src/fitting/similarity.ts）も training GCP を index 昇順に走査し、各点で X²+Y² を加える。
 * 総和順序をテストと実装で一致させているため、厳密一致が保証される。
 * 相対 tolerance 比較を採らなかった理由は tests 冒頭のコメントおよび task-state を参照。
 */
const expectedSseZeroTolerance = (gcps: readonly GcpPair[]): number => {
  let sumGeoSq = 0;
  for (let i = 0; i < gcps.length; i++) {
    const geo = gcps[i].geo;
    sumGeoSq += geo[0] * geo[0] + geo[1] * geo[1];
  }
  return 1024 * Number.EPSILON * Number.EPSILON * sumGeoSq;
};

// ---------------------------------------------------------------------------
// AC-m0-4: 自由度分岐・F gate・option 境界
// ---------------------------------------------------------------------------

describe('AC-m0-4: affine 自由度分岐と F gate', () => {
  test('n=3 は affineSkippedInsufficientDof で similarity を返す (3pts)', () => {
    const r = fitWorldFile(FX_N3);
    expect(r.similarityOnly).toBe(true);
    expect(r.worldFile).not.toBeNull();
    expect(codes(r)).toContain('affineSkippedInsufficientDof');
    expect(codes(r)).not.toContain('validationSkipped');
    expect(r.qualityGate).toBe('adoptable');
    expect(r.status).toBe('ok_with_warnings');
  });

  test('n=4 は affineSkippedInsufficientDof で similarity を返す (4pts)', () => {
    const r = fitWorldFile(FX_N4);
    expect(r.similarityOnly).toBe(true);
    expect(r.worldFile).not.toBeNull();
    expect(codes(r)).toContain('affineSkippedInsufficientDof');
    expect(codes(r)).not.toContain('validationSkipped');
    expect(r.qualityGate).toBe('adoptable');
  });

  test('n=2 は insufficientPointCount と affineSkippedInsufficientDof を併発する (2pts)', () => {
    const r = fitWorldFile([
      { pixel: [0, 0] as const, geo: [100, -50] as const },
      { pixel: [1, 1] as const, geo: [101.2, -48.2] as const },
    ]);
    expect(codes(r)).toContain('insufficientPointCount');
    expect(codes(r)).toContain('affineSkippedInsufficientDof');
    expect(r.qualityGate).toBe('preview');
  });

  test('n=5 の既知 affine 写像で 6 値を tolerance 1e-9 で復元し affine を採用する (5pts)', () => {
    const r = fitWorldFile(FX_EXACT_AFFINE, { debug: true });
    expect(r.similarityOnly).toBe(false);
    const wf = r.worldFile!;
    expect(wf.xScale).toBeCloseTo(2, 9);
    expect(wf.xSkew).toBeCloseTo(0.5, 9);
    expect(wf.xOrigin).toBeCloseTo(100, 9);
    expect(wf.ySkew).toBeCloseTo(-0.25, 9);
    expect(wf.yScale).toBeCloseTo(3, 9);
    expect(wf.yOrigin).toBeCloseTo(200, 9);
    expect(r.qualityGate).toBe('adoptable');
    // holdout 未指定なので validationSkipped のみが立つ（設計 §3.7 #8）
    expect(codes(r)).toEqual(['validationSkipped']);
    expect(r.status).toBe('ok_with_warnings');
    // 選択モデルの training RMS（設計 §3.7）
    expect(r.rmsMeters).not.toBeNull();
    expect(r.rmsMeters!).toBeCloseTo(0, 9);
  });

  test('F 値と自由度: debug の SSE から再計算した F が debug.fStatistic と一致する (5pts)', () => {
    const r = fitWorldFile(FX_GATE_PASS, { debug: true });
    const d = r.debug!;
    expect(d.sseSimilarity).toBeDefined();
    expect(d.sseAffine).toBeDefined();
    const n = FX_GATE_PASS.length;
    const df2 = 2 * n - 6;
    expect(df2).toBe(4);
    // 実装と同一の式・同一の演算順で再計算する ∴ 厳密一致
    const recomputed = ((d.sseSimilarity! - d.sseAffine!) / 2) / (d.sseAffine! / df2);
    expect(d.fStatistic).toBe(recomputed);
    expect(d.fStatistic!).toBeCloseTo(10.298295454545059, 9);
    expect(d.criticalF).toBe(criticalF(0.05, 2, df2));
    expect(d.relativeImprovement).toBe((d.sseSimilarity! - d.sseAffine!) / d.sseSimilarity!);
  });

  test('criticalF は df1=2 / df2=2n-6 の閉形式 (n-3)(alpha^(-1/(n-3))-1) と一致する', () => {
    for (const n of [5, 6, 10]) {
      const df2 = 2 * n - 6;
      expect(criticalF(0.05, 2, df2)).toBe((n - 3) * (Math.pow(0.05, -1 / (n - 3)) - 1));
    }
    expect(criticalF(0.05, 2, 4)).toBeCloseTo(6.944271909999159, 9);
    expect(criticalF(0.05, 2, 6)).toBeCloseTo(5.143252849784719, 9);
    expect(criticalF(0.05, 2, 14)).toBeCloseTo(3.7388918324407365, 9);
  });

  test('criticalF の失敗契約: df1!==2 / df2<=0 / 非有限df2 / 不正alpha は NaN', () => {
    expect(Number.isNaN(criticalF(0.05, 1, 4))).toBe(true);
    expect(Number.isNaN(criticalF(0.05, 3, 4))).toBe(true);
    expect(Number.isNaN(criticalF(0.05, 2, 0))).toBe(true);
    expect(Number.isNaN(criticalF(0.05, 2, -2))).toBe(true);
    expect(Number.isNaN(criticalF(0.05, 2, Number.NaN))).toBe(true);
    expect(Number.isNaN(criticalF(0.05, 2, Number.POSITIVE_INFINITY))).toBe(true);
    expect(Number.isNaN(criticalF(0, 2, 4))).toBe(true);
    expect(Number.isNaN(criticalF(1, 2, 4))).toBe(true);
    expect(Number.isNaN(criticalF(-0.1, 2, 4))).toBe(true);
    expect(Number.isNaN(criticalF(1.5, 2, 4))).toBe(true);
    expect(Number.isNaN(criticalF(Number.NaN, 2, 4))).toBe(true);
    expect(Number.isNaN(criticalF(Number.POSITIVE_INFINITY, 2, 4))).toBe(true);
  });

  test('F gate 不成立なら affine を採用せず affineRejectedNonImproving を出す (5pts)', () => {
    const r = fitWorldFile(FX_F_FAIL, { debug: true });
    expect(r.similarityOnly).toBe(true);
    expect(codes(r)).toContain('affineRejectedNonImproving');
    expect(codes(r)).toContain('validationSkipped');
    expect(r.qualityGate).toBe('adoptable');
    const d = r.debug!;
    expect(d.fStatistic!).toBeCloseTo(2.6046590909089864, 9);
    expect(d.fStatistic! > d.criticalF!).toBe(false);
    // 相対改善自体は 0.01 を大きく超えている ∴ 不採用の原因は F gate 単独である
    expect(d.relativeImprovement!).toBeCloseTo(0.5656573134917598, 9);
  });

  test('alpha: 既定 0.05 で採用される fixture が alpha=0.01 では不採用になる (5pts)', () => {
    const base = fitWorldFile(FX_GATE_PASS, { debug: true });
    expect(base.similarityOnly).toBe(false);
    const strict = fitWorldFile(FX_GATE_PASS, { alpha: 0.01, debug: true });
    expect(strict.similarityOnly).toBe(true);
    expect(codes(strict)).toContain('affineRejectedNonImproving');
    expect(strict.debug!.criticalF).toBe(criticalF(0.01, 2, 4));
  });

  test('alpha: 0 / 1 / 負 / 1超 / NaN / ±Infinity は既定 0.05 と同値 (5pts)', () => {
    const expected = criticalF(0.05, 2, 4);
    for (const alpha of [0, 1, -0.5, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = fitWorldFile(FX_GATE_PASS, { alpha, debug: true });
      expect(r.debug!.criticalF).toBe(expected);
      expect(r.similarityOnly).toBe(false);
    }
  });

  test('相対改善 gate: F 通過でも minRelativeImprovement 未達なら不採用 (5pts)', () => {
    const r = fitWorldFile(FX_GATE_PASS, { minRelativeImprovement: 0.9, debug: true });
    expect(r.similarityOnly).toBe(true);
    expect(codes(r)).toContain('affineRejectedNonImproving');
    // F gate 自体は通っている ∴ 不採用の原因は相対改善 gate 単独である
    expect(r.debug!.fStatistic! > r.debug!.criticalF!).toBe(true);
    expect(r.debug!.relativeImprovement!).toBeCloseTo(0.8373758373758321, 9);
  });

  test('相対改善 gate: 0 と 1 は有効端点である (5pts)', () => {
    // 0 = 統計 gate のみで採否を決める明示設定
    expect(fitWorldFile(FX_GATE_PASS, { minRelativeImprovement: 0 }).similarityOnly).toBe(false);
    // 0 でも F gate 不成立なら採用しない
    expect(fitWorldFile(FX_F_FAIL, { minRelativeImprovement: 0 }).similarityOnly).toBe(true);
    // 1 = training SSE の完全除去だけを許す明示設定
    expect(fitWorldFile(FX_EXACT_AFFINE, { minRelativeImprovement: 1 }).similarityOnly).toBe(false);
    expect(fitWorldFile(FX_GATE_PASS, { minRelativeImprovement: 1 }).similarityOnly).toBe(true);
  });

  test('相対改善 gate: 負 / 1超 / 非有限は既定 0.01 と同値 (5pts)', () => {
    for (const v of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(fitWorldFile(FX_GATE_PASS, { minRelativeImprovement: v }).similarityOnly).toBe(false);
    }
  });

  test('collinearity: threshold=0 でも完全共線（整数座標）は affine を skip する (5pts)', () => {
    const r = fitWorldFile(FX_COLLINEAR5, { collinearityThreshold: 0 });
    expect(r.similarityOnly).toBe(true);
    expect(codes(r)).toContain('nearCollinearSource');
    expect(codes(r)).toContain('affineSkippedCollinear');
    // 共線 skip では holdout 検証に到達しない ∴ validationSkipped は出ない（設計 §3.7 ※）
    expect(codes(r)).not.toContain('validationSkipped');
    expect(r.worldFile).not.toBeNull();
    expect(r.qualityGate).toBe('adoptable');
  });

  test('collinearity: threshold=1 なら有限比を全て skip する (5pts)', () => {
    const r = fitWorldFile(FX_EXACT_AFFINE, { collinearityThreshold: 1 });
    expect(r.similarityOnly).toBe(true);
    expect(codes(r)).toContain('affineSkippedCollinear');
    expect(codes(r)).toContain('nearCollinearSource');
  });

  test('collinearity: 負 / 1超 / 非有限は既定 0.01 と同値 (5pts)', () => {
    for (const v of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = fitWorldFile(FX_EXACT_AFFINE, { collinearityThreshold: v });
      expect(r.similarityOnly).toBe(false);
      expect(codes(r)).not.toContain('affineSkippedCollinear');
    }
  });

  test('fitAffine は完全共線入力（det M = 0）に対し null を返す (5pts)', () => {
    expect(fitAffine(FX_COLLINEAR5)).toBeNull();
    expect(fitAffine(FX_EXACT_AFFINE)).not.toBeNull();
  });

  test('fStatistic / relativeImprovement の直接契約', () => {
    expect(fStatistic(6, 1, 4)).toBe(((6 - 1) / 2) / (1 / 4));
    expect(Number.isNaN(fStatistic(6, 1, 0))).toBe(true);
    expect(Number.isNaN(fStatistic(6, 1, Number.NaN))).toBe(true);
    expect(relativeImprovement(4, 1)).toBe(0.75);
    // Z(SSE4) 相当（SSE4 が正でない）のとき相対改善は 0 とする（設計 §3.5）
    expect(relativeImprovement(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-m0-4: εSSE（数値的ゼロ）分岐
// ---------------------------------------------------------------------------

describe('AC-m0-4: εSSE 数値的ゼロ分岐', () => {
  test('debug.sseZeroTolerance は 1024·Number.EPSILON²·Σ(X²+Y²) の再計算値と一致する (5pts)', () => {
    for (const fx of [FX_SIMILARITY_EXACT, FX_GATE_PASS, FX_EXACT_AFFINE]) {
      const r = fitWorldFile(fx, { debug: true });
      expect(r.debug!.sseZeroTolerance).toBe(expectedSseZeroTolerance(fx));
      // 設計 §3.8: sseZeroTolerance は sseSimilarity と同時に存在する
      expect(r.debug!.sseSimilarity).toBeDefined();
    }
  });

  test('sseZeroTolerance は affine 評価に到達しない分岐では存在しない (3pts / 5pts collinear)', () => {
    expect(fitWorldFile(FX_N3, { debug: true }).debug!.sseZeroTolerance).toBeUndefined();
    expect(fitWorldFile(FX_COLLINEAR5, { debug: true }).debug!.sseZeroTolerance).toBeUndefined();
  });

  test('Z(SSE4) 成立 fixture は affine を採用せず affineRejectedNonImproving を出す (5pts)', () => {
    const r = fitWorldFile(FX_SIMILARITY_EXACT, { debug: true });
    const d = r.debug!;
    expect(d.sseSimilarity!).toBeLessThanOrEqual(d.sseZeroTolerance!);
    expect(d.sseSimilarity!).toBeCloseTo(1.0097419586828951e-28, 30);
    expect(d.sseZeroTolerance!).toBeCloseTo(3.1589666105778918e-24, 30);
    expect(r.similarityOnly).toBe(true);
    expect(codes(r)).toContain('affineRejectedNonImproving');
    expect(codes(r)).toContain('validationSkipped');
    // F gate は評価しない（設計 §3.4 / §3.7 #4）
    expect(d.fStatistic).toBeUndefined();
    expect(d.criticalF).toBeUndefined();
    expect(d.relativeImprovement).toBeUndefined();
  });

  test('Z(SSE6) ∧ ¬Z(SSE4) の fixture は fStatistic===+Infinity で採用される (5pts)', () => {
    const r = fitWorldFile(FX_EXACT_AFFINE, { debug: true });
    const d = r.debug!;
    expect(d.sseAffine!).toBeLessThanOrEqual(d.sseZeroTolerance!);
    expect(d.sseSimilarity! > d.sseZeroTolerance!).toBe(true);
    expect(d.fStatistic).toBe(Number.POSITIVE_INFINITY);
    expect(d.relativeImprovement).toBe(1);
    expect(r.similarityOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-m0-5: holdout と validation
// ---------------------------------------------------------------------------

describe('AC-m0-5: holdout 検証', () => {
  test('holdout 未指定なら validationSkipped を出す (5pts)', () => {
    const r = fitWorldFile(FX_GATE_PASS);
    expect(codes(r)).toContain('validationSkipped');
  });

  test('holdout 空配列は未指定と同じ結果になる (5pts)', () => {
    const a = fitWorldFile(FX_GATE_PASS);
    const b = fitWorldFile(FX_GATE_PASS, { holdout: [] });
    expect(codes(b)).toEqual(codes(a));
    expect(b.status).toBe(a.status);
    expect(b.similarityOnly).toBe(a.similarityOnly);
    expect(b.worldFile).toEqual(a.worldFile);
  });

  test('holdout RMS が悪化したら affine を採用しない (5pts train / 1pt holdout)', () => {
    // holdout の geo は similarity 予測寄り（実測 rmsSim=0.0498 / rmsAff=1.8545）
    const r = fitWorldFile(FX_GATE_PASS, {
      holdout: [{ pixel: [10, -10] as const, geo: [117.5, -63.7] as const }],
      debug: true,
    });
    expect(r.similarityOnly).toBe(true);
    expect(codes(r)).toContain('affineRejectedNonImproving');
    expect(codes(r)).not.toContain('validationSkipped');
    const d = r.debug!;
    expect(d.holdoutRmsAffine! > d.holdoutRmsSimilarity!).toBe(true);
    const w = r.warnings.find((x) => x.code === 'affineRejectedNonImproving')!;
    expect(w.detail).toContain('holdout');
  });

  test('holdout RMS が悪化しなければ affine を採用し validationSkipped は出さない (5pts train / 1pt holdout)', () => {
    // holdout の geo は affine 予測寄り（実測 rmsSim=1.8408 / rmsAff=0.0410）
    const r = fitWorldFile(FX_GATE_PASS, {
      holdout: [{ pixel: [10, -10] as const, geo: [116.8, -62] as const }],
      debug: true,
    });
    expect(r.similarityOnly).toBe(false);
    expect(codes(r)).toEqual([]);
    expect(r.status).toBe('ok');
    const d = r.debug!;
    expect(d.holdoutRmsAffine! <= d.holdoutRmsSimilarity!).toBe(true);
  });

  test('非有限 holdout は insufficient / unusable / null / warnings 空になる (5pts train)', () => {
    const cases: readonly GcpPair[][] = [
      [{ pixel: [Number.NaN, 0] as const, geo: [110, -55] as const }],
      [{ pixel: [0, Number.POSITIVE_INFINITY] as const, geo: [110, -55] as const }],
      [{ pixel: [1, 1] as const, geo: [Number.NaN, -55] as const }],
      [{ pixel: [1, 1] as const, geo: [110, Number.NEGATIVE_INFINITY] as const }],
    ];
    for (const holdout of cases) {
      const r = fitWorldFile(FX_GATE_PASS, { holdout });
      expect(r.status).toBe('insufficient');
      expect(r.qualityGate).toBe('unusable');
      expect(r.worldFile).toBeNull();
      expect(r.similarityOnly).toBe(true);
      expect(r.warnings).toHaveLength(0);
      expect(r.rmsMeters).toBeNull();
    }
  });
});

/**
 * Demo presets: each contrast in `demo/presets.js` must produce visibly different output.
 *
 * This test calls the real `fitWorldFile` (imported from `src`, not `dist`) with the exact
 * GCP sets the demo page uses. It guards the demo's parts only: a green run does NOT prove
 * the behaviour is what a human asked for — that is judged by looking at the page.
 *
 * Assertions are written as properties (which model, which warnings, which point stands out),
 * not as baked numbers, so small numeric drift in the fitter does not make the demo "fail".
 */
import { describe, expect, it } from 'vitest';

import { fitWorldFile } from '../src/index.js';
import type { FitResult, GcpPair, WorldFile } from '../src/index.js';
import { CONTRASTS, FIT_OPTIONS, findPreset } from '../demo/presets.js';

function run(contrastKey: string, optionKey: string): FitResult {
  const preset = findPreset(contrastKey, optionKey);
  if (preset === undefined) throw new Error(`preset ${contrastKey}:${optionKey} is missing`);
  return fitWorldFile(preset.gcps as readonly GcpPair[], FIT_OPTIONS as never);
}

function codes(result: FitResult): string[] {
  return result.warnings.map((warning) => warning.code);
}

function residuals(worldFile: WorldFile, gcps: readonly GcpPair[]): number[] {
  return gcps.map(({ pixel: [u, v], geo: [x, y] }) => {
    const px = worldFile.xScale * u + worldFile.xSkew * v + worldFile.xOrigin;
    const py = worldFile.ySkew * u + worldFile.yScale * v + worldFile.yOrigin;
    return Math.hypot(x - px, y - py);
  });
}

describe('demo presets: shape', () => {
  it('has four contrasts, each with at least two options carrying a label, an expectation line and GCPs', () => {
    expect(CONTRASTS.map((contrast) => contrast.key)).toEqual(['model', 'count', 'layout', 'outlier']);
    for (const contrast of CONTRASTS) {
      expect(contrast.title.length).toBeGreaterThan(0);
      expect(contrast.options.length).toBeGreaterThanOrEqual(2);
      for (const option of contrast.options) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.expectation.length).toBeGreaterThan(0);
        expect(option.gcps.length).toBeGreaterThanOrEqual(2);
        for (const gcp of option.gcps) {
          expect(gcp.pixel).toHaveLength(2);
          expect(gcp.geo).toHaveLength(2);
          expect(gcp.pixel.every(Number.isFinite) && gcp.geo.every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it('uses planar metre coordinates with debug output', () => {
    expect(FIT_OPTIONS).toEqual({ geoBasis: { kind: 'planar_xy', axisOrder: 'xy', unit: 'm' }, debug: true });
  });
});

describe('demo presets: outputs split as each contrast promises', () => {
  it('model: rotation/scale only → similarity; sheared → affine with F above the critical value', () => {
    const a = run('model', 'similar');
    const b = run('model', 'sheared');
    expect(a.similarityOnly).toBe(true);
    expect(codes(a)).toContain('affineRejectedNonImproving');
    expect(b.similarityOnly).toBe(false);
    expect(b.debug?.fStatistic).toBeDefined();
    expect(b.debug!.fStatistic!).toBeGreaterThan(b.debug!.criticalF!);
    // the similarity shape (xSkew = -ySkew) holds for A and breaks for B
    expect(a.worldFile!.xSkew).toBeCloseTo(-a.worldFile!.ySkew, 9);
    expect(Math.abs(b.worldFile!.xSkew + b.worldFile!.ySkew)).toBeGreaterThan(0.01);
  });

  it('count: 2 points → preview; 3 points → adoptable without affine; 5 points → affine evaluated', () => {
    const two = run('count', 'two');
    const three = run('count', 'three');
    const five = run('count', 'five');
    expect(two.qualityGate).toBe('preview');
    expect(three.qualityGate).toBe('adoptable');
    expect(codes(three)).toContain('affineSkippedInsufficientDof');
    expect(three.debug?.fStatistic).toBeUndefined();
    expect(five.debug?.fStatistic).toBeDefined();
    expect(five.debug?.criticalF).toBeDefined();
  });

  it('layout: only the near-collinear set warns nearCollinearSource and skips affine', () => {
    const spread = run('layout', 'spread');
    const collinear = run('layout', 'collinear');
    expect(codes(spread)).not.toContain('nearCollinearSource');
    expect(codes(collinear)).toContain('nearCollinearSource');
    expect(codes(collinear)).toContain('affineSkippedCollinear');
    expect(collinear.debug?.fStatistic).toBeUndefined();
  });

  it('outlier: one wrong point raises RMS by 10x or more and has the largest residual (point 3)', () => {
    const correct = run('outlier', 'correct');
    const wrong = run('outlier', 'oneWrong');
    expect(correct.rmsMeters).not.toBeNull();
    expect(wrong.rmsMeters).not.toBeNull();
    expect(wrong.rmsMeters!).toBeGreaterThanOrEqual(correct.rmsMeters! * 10);
    // if the wrong point promotes the fit to affine, the F gate must explain it
    if (!wrong.similarityOnly) {
      expect(wrong.debug!.fStatistic!).toBeGreaterThan(wrong.debug!.criticalF!);
    }
    const preset = findPreset('outlier', 'oneWrong')!;
    const r = residuals(wrong.worldFile!, preset.gcps as readonly GcpPair[]);
    expect(r.indexOf(Math.max(...r))).toBe(2);
  });
});

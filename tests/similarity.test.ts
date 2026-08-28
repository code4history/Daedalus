import { describe, test, expect } from 'vitest';
import { fitWorldFile } from '../src/fitting/similarity.js';

describe('similarity closed-form Helmert fitting', () => {
  test('AC-m0-1: Helmert fixture 5pts, tolerance 1e-9', () => {
    // a = 1.5, b = 0.3, tx = 100.0, ty = -50.0
    // pixel -> geo: (u, v) -> (a*u - b*v + tx, b*u + a*v + ty)
    const gcps = [
      { pixel: [0, 0] as const, geo: [100.0, -50.0] as const },
      { pixel: [1, 0] as const, geo: [101.5, -49.7] as const },
      { pixel: [0, 1] as const, geo: [99.7, -48.5] as const },
      { pixel: [1, 1] as const, geo: [101.2, -48.2] as const },
      { pixel: [2, 3] as const, geo: [102.1, -44.1] as const }, // wait, let's calculate:
      // a=1.5, b=0.3, tx=100, ty=-50
      // u=2, v=3
      // X = 1.5*2 - 0.3*3 + 100 = 3 - 0.9 + 100 = 102.1
      // Y = 0.3*2 + 1.5*3 - 50 = 0.6 + 4.5 - 50 = 5.1 - 50 = -44.9
    ];
    // Correcting 5th point to be exact:
    gcps[4] = { pixel: [2, 3] as const, geo: [102.1, -44.9] as const };

    const result = fitWorldFile(gcps);
    expect(result.worldFile).not.toBeNull();

    const wf = result.worldFile!;
    expect(wf.xScale).toBeCloseTo(1.5, 9);
    expect(wf.xSkew).toBeCloseTo(-0.3, 9);
    expect(wf.xOrigin).toBeCloseTo(100.0, 9);
    expect(wf.ySkew).toBeCloseTo(0.3, 9);
    expect(wf.yScale).toBeCloseTo(1.5, 9);
    expect(wf.yOrigin).toBeCloseTo(-50.0, 9);

    expect(result.similarityOnly).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.qualityGate).toBe('adoptable');
    expect(result.warnings).toHaveLength(0);
  });

  test('AC-m0-2: WorldFile origin is left-top corner (0,0), not center (0.5pts, 4pts)', () => {
    // a = 1.0, b = 0.0, tx = 200.0, ty = 300.0
    const gcps = [
      { pixel: [0, 0] as const, geo: [200.0, 300.0] as const },
      { pixel: [0.5, 0.5] as const, geo: [200.5, 300.5] as const },
      { pixel: [1, 0] as const, geo: [201.0, 300.0] as const },
      { pixel: [0, 1] as const, geo: [200.0, 301.0] as const },
    ];

    const result = fitWorldFile(gcps);
    const wf = result.worldFile!;

    // origin is exact (200, 300) which corresponds to pixel (0,0)
    expect(wf.xOrigin).toBeCloseTo(200.0, 9);
    expect(wf.yOrigin).toBeCloseTo(300.0, 9);

    // forward map of (0.5, 0.5)
    const X = wf.xScale * 0.5 + wf.xSkew * 0.5 + wf.xOrigin;
    const Y = wf.ySkew * 0.5 + wf.yScale * 0.5 + wf.yOrigin;
    expect(X).toBeCloseTo(200.5, 9);
    expect(Y).toBeCloseTo(300.5, 9);
  });

  describe('AC-m0-3: Degradation and warnings', () => {
    test('n=2 -> preview + worldFile', () => {
      const gcps = [
        { pixel: [0, 0] as const, geo: [0, 0] as const },
        { pixel: [1, 1] as const, geo: [1, 1] as const },
      ];
      const result = fitWorldFile(gcps);
      expect(result.qualityGate).toBe('preview');
      expect(result.worldFile).not.toBeNull();
      expect(result.warnings.some(w => w.code === 'insufficientPointCount')).toBe(true);
      expect(result.status).toBe('ok_with_warnings');
    });

    test('n=3 collinear -> similarity + nearCollinearSource', () => {
      const gcps = [
        { pixel: [0, 0] as const, geo: [0, 0] as const },
        { pixel: [1, 1] as const, geo: [1.5, 1.5] as const },
        { pixel: [2, 2] as const, geo: [3.0, 3.0] as const },
      ];
      const result = fitWorldFile(gcps);
      expect(result.worldFile).not.toBeNull();
      expect(result.warnings.some(w => w.code === 'nearCollinearSource')).toBe(true);
      expect(result.qualityGate).not.toBe('unusable');
    });

    test('all-pixel-same -> unusable + null', () => {
      const gcps = [
        { pixel: [1, 1] as const, geo: [0, 0] as const },
        { pixel: [1, 1] as const, geo: [1, 1] as const },
        { pixel: [1, 1] as const, geo: [2, 2] as const },
      ];
      const result = fitWorldFile(gcps);
      expect(result.qualityGate).toBe('unusable');
      expect(result.worldFile).toBeNull();
      expect(result.status).toBe('insufficient');
    });

    test('L_geo < epsilon -> unusable + null', () => {
      const gcps = [
        { pixel: [0, 0] as const, geo: [139.7, 35.6] as const },
        { pixel: [1, 0] as const, geo: [139.7, 35.6] as const },
        { pixel: [0, 1] as const, geo: [139.7, 35.6] as const },
      ];
      const result = fitWorldFile(gcps, { normalizeEpsilonMeters: 100.0 });
      expect(result.qualityGate).toBe('unusable');
      expect(result.worldFile).toBeNull();
    });

    test('unsupportedAxisOrder -> unusable + unsupportedAxisOrder warning', () => {
      const gcps = [
        { pixel: [0, 0] as const, geo: [35.6, 139.7] as const },
        { pixel: [1, 0] as const, geo: [35.7, 139.8] as const },
        { pixel: [0, 1] as const, geo: [35.5, 139.6] as const },
      ];
      const result = fitWorldFile(gcps, {
        geoBasis: { kind: 'lonlat_deg', axisOrder: 'lat-lon' } as any
      });
      expect(result.qualityGate).toBe('unusable');
      expect(result.worldFile).toBeNull();
      expect(result.warnings.some(w => w.code === 'unsupportedAxisOrder')).toBe(true);
    });
  });
});

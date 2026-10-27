// @vitest-environment jsdom
/**
 * Demo page wiring (jsdom, injected fake `fit`).
 *
 * The DOM is built by reading `demo/worldfile-fit.html` itself, so renamed ids in the page
 * break this test. `canvas.getContext` is NOT stubbed: jsdom has no 2D canvas and returns
 * `null`, so every assertion here also proves the page keeps working without a context.
 * Only `getBoundingClientRect` is given a size, because jsdom has no layout.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { arrowMagnification, formatFStatistic, formatNumber, initDemo } from '../demo/main.js';
import { CONTRASTS, FIT_OPTIONS } from '../demo/presets.js';
import { version as packageVersion } from '../package.json';

const testsDir = dirname(fileURLToPath(import.meta.url));
const pageHtml = readFileSync(join(testsDir, '..', 'demo', 'worldfile-fit.html'), 'utf8');
const bodyInner = /<body[^>]*>([\s\S]*)<\/body>/i.exec(pageHtml)?.[1];

const BOARD = { width: 420, height: 320 };

function mountPage(): void {
  if (bodyInner === undefined) throw new Error('cannot read <body> of worldfile-fit.html');
  document.body.innerHTML = bodyInner.replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const id of ['pixel-canvas', 'geo-canvas']) {
    const canvas = document.getElementById(id) as HTMLCanvasElement;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: BOARD.width, bottom: BOARD.height, ...BOARD, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }
}

function fakeResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok_with_warnings',
    qualityGate: 'adoptable',
    worldFile: { xScale: 2.49, xSkew: -0.17, xOrigin: -22000, ySkew: 0.17, yScale: 2.49, yOrigin: -112000 },
    similarityOnly: true,
    rmsMeters: 0.42,
    warnings: [{ code: 'affineRejectedNonImproving' }, { code: 'validationSkipped' }],
    debug: { sse: 1, mse: 0.2, sseSimilarity: 1, sseAffine: 0.9, fStatistic: 0.15, criticalF: 6.94 },
    ...overrides,
  };
}

const allPresets = CONTRASTS.flatMap((contrast) =>
  contrast.options.map((option) => ({ id: `${contrast.key}:${option.key}`, option })),
);

function text(id: string): string {
  return document.getElementById(id)?.textContent ?? '';
}

describe('demo wiring', () => {
  beforeEach(() => {
    mountPage();
  });

  it('renders one button per preset and runs the first preset once on start', async () => {
    const fit = vi.fn(() => fakeResult());
    const demo = initDemo({ document, fit });
    await demo.whenSettled();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-preset]')];
    expect(buttons.map((button) => button.dataset.preset)).toEqual(allPresets.map((preset) => preset.id));
    expect(fit).toHaveBeenCalledTimes(1);
    expect(demo.getState().activePreset).toBe(allPresets[0].id);
    expect(demo.getState().hasContext).toEqual({ pixel: false, geo: false });
  });

  for (const { id, option } of allPresets) {
    it(`button ${id}: calls fit exactly once with the preset GCPs and shows the outputs`, async () => {
      const fit = vi.fn(() => fakeResult());
      const demo = initDemo({ document, fit });
      await demo.whenSettled();
      fit.mockClear();

      document.querySelector<HTMLButtonElement>(`[data-preset="${id}"]`)!.click();

      expect(fit).toHaveBeenCalledTimes(1);
      const [gcps, options] = fit.mock.calls[0] as unknown as [unknown, unknown];
      expect(gcps).toEqual(option.gcps);
      expect(options).toEqual(FIT_OPTIONS);
      expect(demo.getState().activePreset).toBe(id);
      expect(document.querySelector(`[data-preset="${id}"]`)!.getAttribute('aria-pressed')).toBe('true');
      expect(text('preset-expectation')).toBe(option.expectation);

      expect(text('model-label')).toContain('相似');
      expect(document.querySelectorAll('#worldfile-body tr')).toHaveLength(6);
      expect(text('quality-gate')).toBe('adoptable');
      expect(text('fit-status')).toBe('ok_with_warnings');
      expect(text('rms')).toContain('0.42');
      const warnings = [...document.querySelectorAll('#warning-list li')].map((li) => li.textContent ?? '');
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('affineRejectedNonImproving');
      expect(document.querySelectorAll('#residual-body tr')).toHaveLength(option.gcps.length);
    });
  }

  it('shows the affine label, the F bars and the SSE bars when affine is adopted', async () => {
    const fit = vi.fn(() =>
      fakeResult({
        similarityOnly: false,
        warnings: [{ code: 'validationSkipped' }],
        debug: { sse: 1, mse: 0.2, sseSimilarity: 800, sseAffine: 1, fStatistic: 99675, criticalF: 6.94 },
      }),
    );
    const demo = initDemo({ document, fit });
    await demo.whenSettled();
    expect(text('model-label')).toContain('affine');
    expect(text('similar-shape')).toBe('');
    expect(text('f-text')).toContain('99');
    expect(document.querySelectorAll('#f-bars .bar')).toHaveLength(2);
    expect(document.querySelectorAll('#sse-bars .bar')).toHaveLength(2);
  });

  it('says F was not evaluated when debug has no fStatistic', async () => {
    const fit = vi.fn(() =>
      fakeResult({ warnings: [{ code: 'affineSkippedInsufficientDof' }], debug: { sse: 1, mse: 1 } }),
    );
    const demo = initDemo({ document, fit });
    await demo.whenSettled();
    expect(text('f-text')).toContain('F は評価していない');
    expect(document.querySelectorAll('#f-bars .bar')).toHaveLength(0);
  });

  it('draws no F bar for an infinite F and explains it', async () => {
    const fit = vi.fn(() =>
      fakeResult({ similarityOnly: false, debug: { sse: 0, mse: 0, sseSimilarity: 5, sseAffine: 0, fStatistic: Infinity, criticalF: 6.94 } }),
    );
    const demo = initDemo({ document, fit });
    await demo.whenSettled();
    expect(text('f-text')).toContain('F = ∞');
    expect(document.querySelectorAll('#f-bars .bar')).toHaveLength(1);
  });

  it('dragging a pixel marker recomputes once on release with the moved point', async () => {
    const fit = vi.fn(() => fakeResult());
    const demo = initDemo({ document, fit });
    await demo.whenSettled();
    fit.mockClear();
    const before = demo.getState().gcps[0].pixel;
    const [bx, by] = demo.getState().pixelMarkers[0];
    const canvas = document.getElementById('pixel-canvas')!;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: bx, clientY: by, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: bx + 20, clientY: by + 10, bubbles: true }));
    expect(fit).not.toHaveBeenCalled();
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: bx + 20, clientY: by + 10, bubbles: true }));
    expect(fit).toHaveBeenCalledTimes(1);
    const after = demo.getState().gcps[0].pixel;
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeLessThan(before[1]); // v axis points up on the board
  });

  it('shows the package version in the footer', async () => {
    const demo = initDemo({ document, fit: vi.fn(() => fakeResult()) });
    await demo.whenSettled();
    expect(text('version')).toContain(`@c4h/daedalus ${packageVersion}`);
  });

  it('shows the error and does not throw when fit throws', async () => {
    const demo = initDemo({
      document,
      fit: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    await demo.whenSettled();
    expect(text('error')).toContain('boom');
  });
});

describe('formatFStatistic', () => {
  it('formats infinity, missing and finite values', () => {
    expect(formatFStatistic(Infinity)).toContain('F = ∞');
    expect(formatFStatistic(Infinity)).toContain('affine で完全に当たる');
    expect(formatFStatistic(undefined)).toBe('F は評価していない');
    expect(formatFStatistic(0.147)).toContain('0.147');
  });
});

describe('formatNumber', () => {
  it('keeps trailing zeros of integers and trims only decimal zeros', () => {
    expect(formatNumber(120, 0)).toBe('120');
    expect(formatNumber(-111780, 0)).toBe('-111780');
    expect(formatNumber(2.5, 4)).toBe('2.5');
    expect(formatNumber(0, 3)).toBe('0');
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('arrowMagnification', () => {
  it('scales the longest residual to about 40 board px', () => {
    // 0.5 m at 0.1 px/m is 0.05 px → x800
    expect(arrowMagnification(0.5, 0.1)).toBe(800);
  });
  it('never shrinks arrows that are already long', () => {
    expect(arrowMagnification(100, 1)).toBe(1);
  });
  it('returns 0 (draw no arrows) when residuals are only floating-point noise', () => {
    expect(arrowMagnification(3.6e-12, 0.1)).toBe(0);
    expect(arrowMagnification(0, 0.1)).toBe(0);
  });
});

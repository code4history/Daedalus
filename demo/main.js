/**
 * World-file fitting demo: DOM wiring and drawing.
 *
 * This file does no fitting of its own. It calls `fit` (by default `fitWorldFile` from `src`,
 * injectable for tests) and only draws what comes back. Residual arrows are drawn by applying
 * the returned world file to each pixel point — that is reading the output, not a second fitter.
 *
 * Rules kept here:
 * - `canvas.getContext('2d')` may be `null` (jsdom). Every draw function returns early on a
 *   null context; everything else (fit, tables, events) still runs.
 * - DOM text is set with `textContent` and DOM APIs only.
 */
import { fitWorldFile } from '../src/index.ts';
import { version as packageVersion } from '../package.json';
import { CONTRASTS, FIT_OPTIONS } from './presets.js';

const BOARD_WIDTH = 420;
const BOARD_HEIGHT = 320;
const BOARD_PADDING = { left: 64, right: 44, top: 44, bottom: 40 };
/** Distance (board px) within which a press grabs a marker. */
const GRAB_RADIUS = 14;
/** The longest residual arrow is drawn about this long (board px). */
const ARROW_TARGET_PX = 40;

const COLOR = {
  marker: '#c0392b',
  markerActive: '#3a7bd5',
  outline: '#ffffff',
  axis: '#8aadcc',
  grid: '#dfe6ee',
  label: '#1f2d3d',
  arrow: '#d35400',
  predicted: '#7f8c8d',
};

const WORLD_FILE_ROWS = [
  ['xScale', 'A: x 方向の縮尺（m/px）'],
  ['ySkew', 'D: u が y に効く量'],
  ['xSkew', 'B: v が x に効く量'],
  ['yScale', 'E: y 方向の縮尺（m/px）'],
  ['xOrigin', 'C: 原点の x（m）'],
  ['yOrigin', 'F: 原点の y（m）'],
];

/** One-line explanation per warning code. */
export const WARNING_TEXT = Object.freeze({
  affineRejectedNonImproving: 'affine にしても良くならないので相似を採った（正常）',
  validationSkipped: '検証用の点（holdout）を渡していない（正常）',
  insufficientPointCount: '点が少ないので仮の答え（preview）にとどめた',
  affineSkippedInsufficientDof: '点が足りず affine を評価しなかった（5 点以上で評価する）',
  nearCollinearSource: 'pixel の点が一直線に近い',
  affineSkippedCollinear: '点が一直線に近いので affine を評価しなかった',
  unsupportedAxisOrder: 'この軸の順序は扱えない',
});

const QUALITY_TEXT = {
  adoptable: '採用できる',
  preview: '仮の答え',
  unusable: '使えない',
};

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export function formatNumber(value, digits = 4) {
  if (value === undefined || value === null) return '—';
  if (value === Infinity) return '∞';
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(3);
  const fixed = value.toFixed(digits);
  if (!fixed.includes('.')) return fixed === '-0' ? '0' : fixed;
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** Text for the F statistic (Infinity and "not evaluated" have their own wording). */
export function formatFStatistic(value) {
  if (value === undefined || value === null) return 'F は評価していない';
  if (value === Infinity) return 'F = ∞（affine で完全に当たる）';
  return `F = ${formatNumber(value, 3)}`;
}

// ---------------------------------------------------------------------------
// coordinates (numbers only)
// ---------------------------------------------------------------------------

/** Data (y up) ↔ board (y down) with one uniform scale for both axes. */
function makeMapper(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (maxX - minX < 1e-9) {
    minX -= 1;
    maxX += 1;
  }
  if (maxY - minY < 1e-9) {
    minY -= 1;
    maxY += 1;
  }
  const innerWidth = BOARD_WIDTH - BOARD_PADDING.left - BOARD_PADDING.right;
  const innerHeight = BOARD_HEIGHT - BOARD_PADDING.top - BOARD_PADDING.bottom;
  const scale = Math.min(innerWidth / (maxX - minX), innerHeight / (maxY - minY));
  const offsetX = BOARD_PADDING.left + (innerWidth - scale * (maxX - minX)) / 2;
  const offsetY = BOARD_PADDING.bottom + (innerHeight - scale * (maxY - minY)) / 2;
  return {
    scale,
    bounds: { minX, maxX, minY, maxY },
    toBoard: ([x, y]) => [offsetX + (x - minX) * scale, BOARD_HEIGHT - offsetY - (y - minY) * scale],
    fromBoard: ([bx, by]) => [minX + (bx - offsetX) / scale, minY + (BOARD_HEIGHT - offsetY - by) / scale],
  };
}

/** Residuals shorter than this (metres) are floating-point noise: no arrows are drawn. */
const RESIDUAL_NOISE_METRES = 1e-6;

/**
 * How much to magnify residual arrows so the longest is about ARROW_TARGET_PX on the board.
 * Returns 0 when every residual is noise (draw no arrows); never shrinks (minimum 1).
 */
export function arrowMagnification(maxResidualMetres, boardPxPerMetre) {
  if (!(maxResidualMetres >= RESIDUAL_NOISE_METRES) || !(boardPxPerMetre > 0)) return 0;
  const k = ARROW_TARGET_PX / (maxResidualMetres * boardPxPerMetre);
  return k < 1 ? 1 : Math.round(k);
}

function applyWorldFile(worldFile, [u, v]) {
  return [
    worldFile.xScale * u + worldFile.xSkew * v + worldFile.xOrigin,
    worldFile.ySkew * u + worldFile.yScale * v + worldFile.yOrigin,
  ];
}

function residualsOf(result, gcps) {
  if (!result?.worldFile) return [];
  return gcps.map((pair) => {
    const predicted = applyWorldFile(result.worldFile, pair.pixel);
    const dx = pair.geo[0] - predicted[0];
    const dy = pair.geo[1] - predicted[1];
    return { predicted, dx, dy, length: Math.hypot(dx, dy) };
  });
}

function copyGcps(gcps) {
  return gcps.map((pair) => ({ pixel: [pair.pixel[0], pair.pixel[1]], geo: [pair.geo[0], pair.geo[1]] }));
}

// ---------------------------------------------------------------------------
// drawing (each returns early when there is no 2D context)
// ---------------------------------------------------------------------------

function drawFrame(ctx, mapper, unitLabel) {
  ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.save();
  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, BOARD_WIDTH - 1, BOARD_HEIGHT - 1);
  // axes along the bottom-left edge of the data box
  const [x0, y0] = mapper.toBoard([mapper.bounds.minX, mapper.bounds.minY]);
  const [x1] = mapper.toBoard([mapper.bounds.maxX, mapper.bounds.minY]);
  const [, y1] = mapper.toBoard([mapper.bounds.minX, mapper.bounds.maxY]);
  ctx.strokeStyle = COLOR.axis;
  ctx.beginPath();
  ctx.moveTo(x0, y1);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.stroke();
  ctx.fillStyle = COLOR.label;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${formatNumber(mapper.bounds.minX, 0)}`, x0, y0 + 14);
  ctx.textAlign = 'right';
  ctx.fillText(`${formatNumber(mapper.bounds.maxX, 0)} ${unitLabel}`, x1, y0 + 14);
  ctx.fillText(`${formatNumber(mapper.bounds.maxY, 0)}`, x0 - 4, y1 + 4);
  ctx.fillText(`${formatNumber(mapper.bounds.minY, 0)}`, x0 - 4, y0);
  ctx.restore();
}

function drawMarker(ctx, [bx, by], index, active) {
  ctx.save();
  ctx.fillStyle = active ? COLOR.markerActive : COLOR.marker;
  ctx.strokeStyle = COLOR.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLOR.label;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(index + 1), bx + 9, by - 8);
  ctx.restore();
}

function drawArrow(ctx, [fx, fy], [tx, ty]) {
  const length = Math.hypot(tx - fx, ty - fy);
  if (length < 0.5) return;
  const angle = Math.atan2(ty - fy, tx - fx);
  const head = Math.min(8, length / 2);
  ctx.save();
  ctx.strokeStyle = COLOR.arrow;
  ctx.fillStyle = COLOR.arrow;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - head * Math.cos(angle - 0.4), ty - head * Math.sin(angle - 0.4));
  ctx.lineTo(tx - head * Math.cos(angle + 0.4), ty - head * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

export function initDemo(config = {}) {
  const doc = config.document ?? globalThis.document;
  const fit = config.fit ?? fitWorldFile;
  const $ = (id) => doc.getElementById(id);

  const el = {
    presetBar: $('preset-bar'),
    expectation: $('preset-expectation'),
    pixelCanvas: $('pixel-canvas'),
    geoCanvas: $('geo-canvas'),
    modelLabel: $('model-label'),
    similarShape: $('similar-shape'),
    worldfileBody: $('worldfile-body'),
    qualityGate: $('quality-gate'),
    qualityText: $('quality-text'),
    fitStatus: $('fit-status'),
    rms: $('rms'),
    warningList: $('warning-list'),
    residualBody: $('residual-body'),
    residualScale: $('residual-scale'),
    fText: $('f-text'),
    fBars: $('f-bars'),
    sseText: $('sse-text'),
    sseBars: $('sse-bars'),
    status: $('status'),
    error: $('error'),
    version: $('version'),
  };

  const pixelCtx = el.pixelCanvas?.getContext?.('2d') ?? null;
  const geoCtx = el.geoCanvas?.getContext?.('2d') ?? null;

  const state = {
    activePreset: null,
    gcps: [],
    pixelMapper: null,
    result: null,
    recalcCount: 0,
    dragIndex: -1,
  };

  const setText = (node, text) => {
    if (node) node.textContent = text;
  };
  const clear = (node) => {
    while (node?.firstChild) node.removeChild(node.firstChild);
  };
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- preset bar --------------------------------------------------------

  const presetButtons = [];
  function renderPresetBar() {
    if (!el.presetBar) return;
    clear(el.presetBar);
    for (const contrast of CONTRASTS) {
      const group = make('div', 'daedalus-preset-group');
      group.appendChild(make('span', 'daedalus-preset-title', contrast.title));
      for (const option of contrast.options) {
        const button = make('button', 'daedalus-preset-btn', option.label);
        button.type = 'button';
        button.dataset.preset = `${contrast.key}:${option.key}`;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => applyPreset(contrast, option));
        presetButtons.push(button);
        group.appendChild(button);
      }
      el.presetBar.appendChild(group);
    }
  }

  function applyPreset(contrast, option) {
    const id = `${contrast.key}:${option.key}`;
    state.activePreset = id;
    state.gcps = copyGcps(option.gcps);
    state.pixelMapper = makeMapper(state.gcps.map((pair) => pair.pixel));
    for (const button of presetButtons) {
      const pressed = button.dataset.preset === id;
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.toggle('active', pressed);
    }
    setText(el.expectation, option.expectation);
    recalculate();
  }

  // ---- outputs -------------------------------------------------------------

  function renderWorldFile(result) {
    clear(el.worldfileBody);
    const wf = result.worldFile;
    for (const [key, description] of WORLD_FILE_ROWS) {
      const row = make('tr');
      row.appendChild(make('th', '', key));
      row.appendChild(make('td', 'daedalus-num', wf ? formatNumber(wf[key], 6) : '—'));
      row.appendChild(make('td', 'daedalus-muted', description));
      el.worldfileBody?.appendChild(row);
    }
    if (wf && result.similarityOnly) {
      setText(el.similarShape, '相似の形: xSkew = −ySkew・xScale = yScale');
    } else {
      setText(el.similarShape, '');
    }
  }

  function renderWarnings(result) {
    clear(el.warningList);
    if (result.warnings.length === 0) {
      el.warningList?.appendChild(make('li', 'daedalus-muted', 'warning なし'));
      return;
    }
    for (const warning of result.warnings) {
      const item = make('li');
      item.appendChild(make('code', '', warning.code));
      item.appendChild(doc.createTextNode(` — ${WARNING_TEXT[warning.code] ?? ''}`));
      el.warningList?.appendChild(item);
    }
  }

  function residualMagnification(residuals, geoMapper) {
    if (!geoMapper) return 0;
    return arrowMagnification(Math.max(0, ...residuals.map((r) => r.length)), geoMapper.scale);
  }

  function renderResiduals(residuals, k) {
    clear(el.residualBody);
    residuals.forEach((r, index) => {
      const row = make('tr');
      row.appendChild(make('td', '', String(index + 1)));
      row.appendChild(make('td', 'daedalus-num', formatNumber(r.dx, 3)));
      row.appendChild(make('td', 'daedalus-num', formatNumber(r.dy, 3)));
      row.appendChild(make('td', 'daedalus-num', formatNumber(r.length, 3)));
      el.residualBody?.appendChild(row);
    });
    setText(
      el.residualScale,
      residuals.length === 0 ? '' : k === 0 ? '残差はほぼ 0（矢印なし）' : `矢印は残差の ×${k}`,
    );
  }

  /** Horizontal bars on a log scale (values span 0.1 … 100000). */
  function renderBars(container, bars) {
    clear(container);
    const scaled = (value) => Math.log10(1 + Math.max(0, value));
    const top = Math.max(1e-9, ...bars.map((bar) => scaled(bar.value)));
    for (const bar of bars) {
      const row = make('div', 'daedalus-bar-row');
      row.appendChild(make('span', 'daedalus-bar-label', bar.label));
      const track = make('span', 'daedalus-bar-track');
      const fill = make('span', `bar ${bar.className}`);
      fill.style.width = `${Math.max(1, (scaled(bar.value) / top) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(make('span', 'daedalus-num', formatNumber(bar.value, 3)));
      container?.appendChild(row);
    }
  }

  function renderF(result) {
    const debug = result.debug ?? {};
    if (debug.fStatistic === undefined) {
      const reason = result.warnings.find((w) => w.code.startsWith('affineSkipped'));
      setText(el.fText, `F は評価していない${reason ? `（${WARNING_TEXT[reason.code]}）` : ''}`);
      renderBars(el.fBars, []);
      return;
    }
    const verdict = debug.fStatistic > debug.criticalF ? '臨界値を超える → affine が有意' : '臨界値以下 → 相似で足りる';
    setText(el.fText, `${formatFStatistic(debug.fStatistic)}・臨界値 ${formatNumber(debug.criticalF, 3)}（${verdict}）`);
    const bars = [];
    if (Number.isFinite(debug.fStatistic)) bars.push({ label: 'F', value: debug.fStatistic, className: 'daedalus-bar-f' });
    bars.push({ label: '臨界値', value: debug.criticalF, className: 'daedalus-bar-critical' });
    renderBars(el.fBars, bars);
  }

  function renderSse(result) {
    const debug = result.debug ?? {};
    if (debug.sseSimilarity === undefined || debug.sseAffine === undefined) {
      setText(el.sseText, '相似と affine の SSE は affine を評価したときだけ出る');
      renderBars(el.sseBars, []);
      return;
    }
    setText(el.sseText, '残差の二乗和（m²）。相似が affine より大きく離れていれば、相似では当たらない');
    renderBars(el.sseBars, [
      { label: '相似', value: debug.sseSimilarity, className: 'daedalus-bar-similar' },
      { label: 'affine', value: debug.sseAffine, className: 'daedalus-bar-affine' },
    ]);
  }

  function drawPixelBoard() {
    if (!pixelCtx || !state.pixelMapper) return;
    drawFrame(pixelCtx, state.pixelMapper, 'px');
    state.gcps.forEach((pair, index) =>
      drawMarker(pixelCtx, state.pixelMapper.toBoard(pair.pixel), index, index === state.dragIndex),
    );
  }

  function drawGeoBoard(residuals, k, geoMapper) {
    if (!geoCtx || !geoMapper) return;
    drawFrame(geoCtx, geoMapper, 'm');
    if (k > 0) residuals.forEach((r, index) => {
      const actual = state.gcps[index].geo;
      const from = [actual[0] - k * r.dx, actual[1] - k * r.dy];
      drawArrow(geoCtx, geoMapper.toBoard(from), geoMapper.toBoard(actual));
    });
    state.gcps.forEach((pair, index) => drawMarker(geoCtx, geoMapper.toBoard(pair.geo), index, false));
  }

  function render(result) {
    const geoMapper = state.gcps.length > 0 ? makeMapper(state.gcps.map((pair) => pair.geo)) : null;
    const residuals = residualsOf(result, state.gcps);
    const k = residualMagnification(residuals, geoMapper);

    setText(
      el.modelLabel,
      result.worldFile === null
        ? '当てはめられなかった'
        : result.similarityOnly
          ? '相似（回転・等方スケール・平行移動）'
          : 'affine（shear を含む）',
    );
    el.modelLabel?.classList.toggle('daedalus-affine', result.worldFile !== null && !result.similarityOnly);
    setText(el.qualityGate, result.qualityGate);
    setText(el.qualityText, QUALITY_TEXT[result.qualityGate] ?? '');
    setText(el.fitStatus, result.status);
    setText(el.rms, result.rmsMeters === null ? '—' : `${formatNumber(result.rmsMeters, 4)} m`);
    renderWorldFile(result);
    renderWarnings(result);
    renderResiduals(residuals, k);
    renderF(result);
    renderSse(result);
    drawPixelBoard();
    drawGeoBoard(residuals, k, geoMapper);
  }

  function recalculate() {
    state.recalcCount += 1;
    setText(el.error, '');
    try {
      const result = fit(copyGcps(state.gcps), FIT_OPTIONS);
      state.result = result;
      render(result);
      setText(el.status, `計算した（${state.gcps.length} 点）`);
    } catch (error) {
      state.result = null;
      setText(el.error, error instanceof Error ? error.message : String(error));
      setText(el.status, '計算に失敗した');
      drawPixelBoard();
    }
  }

  // ---- dragging on the pixel board ----------------------------------------

  function boardPointFromEvent(event) {
    const rect = el.pixelCanvas.getBoundingClientRect();
    const sx = rect.width > 0 ? BOARD_WIDTH / rect.width : 1;
    const sy = rect.height > 0 ? BOARD_HEIGHT / rect.height : 1;
    return [(event.clientX - rect.left) * sx, (event.clientY - rect.top) * sy];
  }

  function onPointerDown(event) {
    if (!state.pixelMapper) return;
    const [bx, by] = boardPointFromEvent(event);
    let best = -1;
    let bestDistance = GRAB_RADIUS;
    state.gcps.forEach((pair, index) => {
      const [mx, my] = state.pixelMapper.toBoard(pair.pixel);
      const distance = Math.hypot(mx - bx, my - by);
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best < 0) return;
    state.dragIndex = best;
    el.pixelCanvas.setPointerCapture?.(event.pointerId);
    drawPixelBoard();
  }

  function onPointerMove(event) {
    if (state.dragIndex < 0) return;
    const [u, v] = state.pixelMapper.fromBoard(boardPointFromEvent(event));
    state.gcps[state.dragIndex].pixel = [Math.round(u), Math.round(v)];
    drawPixelBoard();
  }

  function onPointerUp(event) {
    if (state.dragIndex < 0) return;
    onPointerMove(event);
    state.dragIndex = -1;
    recalculate();
  }

  function pixelMarkers() {
    if (!state.pixelMapper || !el.pixelCanvas) return [];
    const rect = el.pixelCanvas.getBoundingClientRect();
    const sx = rect.width > 0 ? rect.width / BOARD_WIDTH : 1;
    const sy = rect.height > 0 ? rect.height / BOARD_HEIGHT : 1;
    return state.gcps.map((pair) => {
      const [bx, by] = state.pixelMapper.toBoard(pair.pixel);
      return [rect.left + bx * sx, rect.top + by * sy];
    });
  }

  // ---- start ---------------------------------------------------------------

  setText(el.version, `使っている版: @c4h/daedalus ${packageVersion}`);
  renderPresetBar();
  el.pixelCanvas?.addEventListener('pointerdown', onPointerDown);
  el.pixelCanvas?.addEventListener('pointermove', onPointerMove);
  el.pixelCanvas?.addEventListener('pointerup', onPointerUp);
  el.pixelCanvas?.addEventListener('pointercancel', onPointerUp);
  const first = CONTRASTS[0];
  applyPreset(first, first.options[0]);

  return {
    whenSettled: () => Promise.resolve(),
    getRecalcCount: () => state.recalcCount,
    getState: () => ({
      activePreset: state.activePreset,
      gcps: copyGcps(state.gcps),
      pixelMarkers: pixelMarkers(),
      result: state.result,
      hasContext: { pixel: pixelCtx !== null, geo: geoCtx !== null },
    }),
  };
}

// Start only when the page asks for it, so tests can build the DOM and inject `fit` first.
if (typeof document !== 'undefined' && document.body?.dataset?.demoAutoInit === 'true') {
  initDemo();
}

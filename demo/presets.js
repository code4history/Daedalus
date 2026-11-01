/**
 * Demo presets (data only — this module never touches the DOM).
 *
 * Both the demo page (`demo/main.js`) and the tests (`tests/demo-presets.test.ts`,
 * `tests/demo-wiring.test.ts`) import these values, so a typo here shows up as a test that no
 * longer splits the way the contrast promises.
 *
 * Coordinates: the CRS side is a planar metric system near Kyoto Station (JGD2011 / Japan
 * Plane Rectangular CS VI, metres). The pixel side has its v axis pointing UP (origin at the
 * bottom-left). The "true" map is a similarity: 2.5 m/px, rotated 4°, origin (-22000, -112000).
 * A small fixed error (0.1–0.5 m) is added to every CRS point, as real GCPs always have some;
 * with zero error the affine F test would never be reached for a similarity map.
 */

export const GEO_BASIS = Object.freeze({ kind: 'planar_xy', axisOrder: 'xy', unit: 'm' });

export const FIT_OPTIONS = Object.freeze({ geoBasis: GEO_BASIS, debug: true });

/** Five well spread pixel positions (v up). */
const PIXELS = [
  [120, 80],
  [900, 140],
  [480, 520],
  [160, 860],
  [940, 900],
];

/** Fixed per-point error in metres, added to the CRS side. */
const ERRORS = [
  [0.4, -0.3],
  [-0.2, 0.5],
  [0.3, 0.2],
  [-0.5, -0.1],
  [0.1, -0.4],
];

const METRES_PER_PIXEL = 2.5;
const ROTATION_DEG = 4;
const ORIGIN = [-22000, -112000];

/** The true map: similarity (rotation + uniform scale + translation). */
function truth([u, v]) {
  const theta = (ROTATION_DEG * Math.PI) / 180;
  const s = METRES_PER_PIXEL;
  return [
    ORIGIN[0] + s * (Math.cos(theta) * u - Math.sin(theta) * v),
    ORIGIN[1] + s * (Math.sin(theta) * u + Math.cos(theta) * v),
  ];
}

const round = (value) => Math.round(value * 1000) / 1000;

function gcp(pixel, geo, error) {
  return Object.freeze({
    pixel: Object.freeze([pixel[0], pixel[1]]),
    geo: Object.freeze([round(geo[0] + error[0]), round(geo[1] + error[1])]),
  });
}

function gcpsFrom(pixels, mapPixel = truth) {
  return Object.freeze(pixels.map((pixel, i) => gcp(pixel, mapPixel(pixel), ERRORS[i % ERRORS.length])));
}

const SHEAR = 0.15;
const sheared = ([u, v]) => truth([u + SHEAR * v, v]);

const BASE = gcpsFrom(PIXELS);
const SHEARED = gcpsFrom(PIXELS, sheared);
const COLLINEAR = gcpsFrom([
  [100, 100],
  [300, 301],
  [500, 499],
  [700, 702],
  [900, 900],
]);
/** Point 3 (index 2) placed 75 m off: (+60, -45) m. */
const ONE_WRONG = Object.freeze(
  BASE.map((pair, i) =>
    i === 2 ? Object.freeze({ pixel: pair.pixel, geo: Object.freeze([round(pair.geo[0] + 60), round(pair.geo[1] - 45)]) }) : pair,
  ),
);

/**
 * Four contrasts. Each option is one button: pressing it loads its GCPs and runs the fit once.
 * `expectation` is the one line shown under the bar ("with this input you should see ...").
 */
export const CONTRASTS = Object.freeze([
  {
    key: 'model',
    title: 'モデルが分かれる',
    options: [
      {
        key: 'similar',
        label: '回転と縮尺だけの地図',
        expectation:
          '「相似」を採る。6 値は相似の形（xSkew = −ySkew・xScale = yScale）。残差の矢印はどれも短い。warning が 2 つ出るが正常。',
        gcps: BASE,
      },
      {
        key: 'sheared',
        label: '横にゆがんだ地図',
        expectation: '「affine」を採る。xSkew と −ySkew が一致しない。F は臨界値を大きく超え、相似の SSE が affine よりずっと大きい。',
        gcps: SHEARED,
      },
    ],
  },
  {
    key: 'count',
    title: '点の数で確かさが分かれる',
    options: [
      {
        key: 'two',
        label: 'GCP 2 点',
        expectation: '品質は preview（仮の答え）。affine は評価しない。',
        gcps: Object.freeze(BASE.slice(0, 2)),
      },
      {
        key: 'three',
        label: 'GCP 3 点',
        expectation: '品質は adoptable（採用できる）。ただし点が足りず affine は評価しない（F の棒は出ない）。',
        gcps: Object.freeze(BASE.slice(0, 3)),
      },
      {
        key: 'five',
        label: 'GCP 5 点',
        expectation: '5 点で初めて affine を評価する。F と臨界値の棒が出る（この入力では F は小さく、相似のまま）。',
        gcps: BASE,
      },
    ],
  },
  {
    key: 'layout',
    title: '点の並びで警告が分かれる',
    options: [
      {
        key: 'spread',
        label: 'ばらけた 5 点',
        expectation: '一直線の警告（nearCollinearSource）は出ない。affine を評価する。',
        gcps: BASE,
      },
      {
        key: 'collinear',
        label: '一直線に近い 5 点',
        expectation: 'nearCollinearSource（一直線に近い）が出て、affine を評価しない。',
        gcps: COLLINEAR,
      },
    ],
  },
  {
    key: 'outlier',
    title: '誤った点が見える',
    options: [
      {
        key: 'correct',
        label: '正しい 5 点',
        expectation: 'RMS は 1 m 未満。残差の矢印はどれも短い。',
        gcps: BASE,
      },
      {
        key: 'oneWrong',
        label: '1 点だけ誤った 5 点',
        expectation:
          '3 番の残差の矢印だけが長く伸び、RMS が数十 m に増える。1 点の誤りは品質の札（adoptable のまま）では止まらず、残差の矢印と RMS でしか見えない。',
        gcps: ONE_WRONG,
      },
    ],
  },
]);

/** Look up one option by contrast key and option key. */
export function findPreset(contrastKey, optionKey) {
  return CONTRASTS.find((contrast) => contrast.key === contrastKey)?.options.find((option) => option.key === optionKey);
}

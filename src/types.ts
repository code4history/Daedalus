export type MaybePromise<T> = T | Promise<T>;

export type WorldFile = {
  xScale: number;
  xSkew: number;
  xOrigin: number;
  ySkew: number;
  yScale: number;
  yOrigin: number;
};

export type GeoBasis =
  | { kind: 'lonlat_deg'; axisOrder: 'lon-lat'; datumNote?: string }
  | { kind: 'planar_xy'; axisOrder: 'xy'; unit: 'm' | 'ft'; note?: string };

export type GcpPair = {
  pixel: readonly [number, number];
  geo: readonly [number, number];
};

export type QualityGate = 'adoptable' | 'preview' | 'unusable';

export type FitStatus = 'ok' | 'ok_with_warnings' | 'insufficient' | 'failed';

export type WarningCode =
  | 'insufficientPointCount'
  | 'nearCollinearSource'
  | 'affineSkippedCollinear'
  | 'affineSkippedInsufficientDof'
  | 'affineRejectedNonImproving'
  | 'validationSkipped'
  | 'unsupportedAxisOrder';

export type FitWarning = {
  code: WarningCode;
  detail?: string;
};

export interface FitOptions {
  geoBasis?: GeoBasis;
  debug?: boolean;
  collinearityThreshold?: number; // for affine (used in t2)
  alpha?: number;                  // for F gate (used in t2)
  minRelativeImprovement?: number; // for F gate (used in t2)
  normalizeEpsilonMeters?: number;
  holdout?: readonly GcpPair[];    // for holdout validation (used in t2)
}

export interface FitResult {
  status: FitStatus;
  qualityGate: QualityGate;
  worldFile: WorldFile | null;
  similarityOnly: boolean;
  rmsMeters: number | null;
  rmsPixels?: number;
  warnings: readonly FitWarning[];
  /**
   * `FitOptions.debug` が真のときだけ存在する診断値。
   * optional field は該当する分岐が実行されたときのみ存在する（m0-t2 設計 v1.2 §3.8）。
   * `sse` / `mse` は**選択モデル**（affine 採用なら affine、不採用なら similarity）のもの。
   */
  debug?: {
    sse: number;
    mse: number;
    /** SSE4: similarity の training SSE（affine 評価に到達したときのみ） */
    sseSimilarity?: number;
    /** SSE6: affine の training SSE（affine を計算できたときのみ） */
    sseAffine?: number;
    /** εSSE = 1024·Number.EPSILON²·Σ(X²+Y²)（affine 評価到達時のみ。sseSimilarity と同時に存在） */
    sseZeroTolerance?: number;
    /** F 統計量（F gate 評価時のみ。Z(SSE6) かつ ¬Z(SSE4) では +Infinity） */
    fStatistic?: number;
    /** criticalF(alpha, 2, 2n-6)（F gate 評価時のみ） */
    criticalF?: number;
    /** (SSE4-SSE6)/SSE4（F gate 評価時のみ） */
    relativeImprovement?: number;
    /** holdout を指定して検証に到達したときのみ */
    holdoutRmsSimilarity?: number;
    /** holdout を指定して検証に到達したときのみ */
    holdoutRmsAffine?: number;
  };
}

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
  debug?: { sse: number; mse: number };
}

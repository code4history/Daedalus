/**
 * 型凍結テスト（境界契約の固定）。
 *
 * 【何を凍結するか】
 * Teiresias と共有する境界契約の型: `WarningCode`（7 値）/ `FitStatus`（4 値）/
 * `QualityGate`（3 値）/ `WorldFile` のキー集合（6 キー）。
 * **追加も削除もコンパイルエラーになる双方向検査**を、値配列と条件型で書く。
 *
 * 【凍結対象から除外するもの（設計 K7）】
 * - `FitResult.debug` の形状: m0-t2 が拡張予定の診断用非契約面であるため凍結しない。
 * - `FitOptions` のキー集合: 同上（将来の変更余地を残す）。
 * いずれも Teiresias と共有する境界契約ではなく、凍結すると並行タスクを不当に RED にする。
 *
 * 【重要: 実行時 assert は型ドリフトを検出しない】
 * 型情報は実行時に消える。本ファイル下部の `expect(...)` は **本ファイル内ローカル配列自身の
 * 整合（件数・重複なし）** を確認するだけであり、`src/types.ts` の型ドリフトは検出しない。
 * vitest は esbuild transform で型を捨てるため、`pnpm test` は条件型 assert を素通りする。
 * **ドリフト検出の担い手は `pnpm run test:types`（tsc）のみ**である。
 * ∴ 本ファイルは `package.json` の `scripts.test:types` の対象に結線されている
 * （outer rule-0012。検査は書いた同一変更で scripts へ結線する）。
 *
 * 【将来 WarningCode 等を増やすとき】
 * `pnpm run test:types` が RED になる。これは outer rule-0015（契約変更は依存 spec を
 * 同一変更で追随させる）の検出装置であり、契約文書・Teiresias 側の追随を強制する。
 */
import { describe, it, expect } from 'vitest';
import type { WarningCode, FitStatus, QualityGate, WorldFile } from '../src/types.js';

// ---------------------------------------------------------------------------
// WarningCode（7 値）
// ---------------------------------------------------------------------------
const warningCodes = [
  'insufficientPointCount',
  'nearCollinearSource',
  'affineSkippedCollinear',
  'affineSkippedInsufficientDof',
  'affineRejectedNonImproving',
  'validationSkipped',
  'unsupportedAxisOrder',
] as const;
type ExpectedWarningCode = (typeof warningCodes)[number];
/** src/types.ts 側に未知値が **追加** されたら TS2322 で RED。 */
const warningCodeNoUnknown: WarningCode extends ExpectedWarningCode ? true : false = true;
/** src/types.ts 側から値が **削除** されたら TS2322 で RED。 */
const warningCodeNoMissing: ExpectedWarningCode extends WarningCode ? true : false = true;

// ---------------------------------------------------------------------------
// FitStatus（4 値）
// ---------------------------------------------------------------------------
const fitStatuses = ['ok', 'ok_with_warnings', 'insufficient', 'failed'] as const;
type ExpectedFitStatus = (typeof fitStatuses)[number];
const fitStatusNoUnknown: FitStatus extends ExpectedFitStatus ? true : false = true;
const fitStatusNoMissing: ExpectedFitStatus extends FitStatus ? true : false = true;

// ---------------------------------------------------------------------------
// QualityGate（3 値）
// ---------------------------------------------------------------------------
const qualityGates = ['adoptable', 'preview', 'unusable'] as const;
type ExpectedQualityGate = (typeof qualityGates)[number];
const qualityGateNoUnknown: QualityGate extends ExpectedQualityGate ? true : false = true;
const qualityGateNoMissing: ExpectedQualityGate extends QualityGate ? true : false = true;

// ---------------------------------------------------------------------------
// WorldFile のキー集合（6 キー）
// ---------------------------------------------------------------------------
const worldFileKeys = ['xScale', 'xSkew', 'xOrigin', 'ySkew', 'yScale', 'yOrigin'] as const;
type ExpectedWorldFileKey = (typeof worldFileKeys)[number];
const worldFileKeyNoUnknown: keyof WorldFile extends ExpectedWorldFileKey ? true : false = true;
const worldFileKeyNoMissing: ExpectedWorldFileKey extends keyof WorldFile ? true : false = true;

const hasNoDuplicate = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

describe('contract freeze (境界契約の型凍結)', () => {
  // 注意: 以下の assert は「本ファイル内ローカル配列自身の整合」のみを確認する。
  // src/types.ts の型ドリフトは検出しない（検出は pnpm run test:types）。
  it('ローカル配列自身が整合している（件数・重複なし）', () => {
    expect(warningCodes).toHaveLength(7);
    expect(fitStatuses).toHaveLength(4);
    expect(qualityGates).toHaveLength(3);
    expect(worldFileKeys).toHaveLength(6);

    expect(hasNoDuplicate(warningCodes)).toBe(true);
    expect(hasNoDuplicate(fitStatuses)).toBe(true);
    expect(hasNoDuplicate(qualityGates)).toBe(true);
    expect(hasNoDuplicate(worldFileKeys)).toBe(true);
  });

  // 型レベル assert の値を参照して未使用化を防ぐ。
  // 型が崩れた場合に RED になるのは tsc（test:types）であり、この it ではない。
  it('型レベル凍結 assert が宣言されている（判定は tsc が行う）', () => {
    expect(warningCodeNoUnknown).toBe(true);
    expect(warningCodeNoMissing).toBe(true);
    expect(fitStatusNoUnknown).toBe(true);
    expect(fitStatusNoMissing).toBe(true);
    expect(qualityGateNoUnknown).toBe(true);
    expect(qualityGateNoMissing).toBe(true);
    expect(worldFileKeyNoUnknown).toBe(true);
    expect(worldFileKeyNoMissing).toBe(true);
  });
});

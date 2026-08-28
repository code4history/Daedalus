/**
 * CandidateTransformer 契約 8 項目の検証（Daedalus 側 mock の適合確認）。
 *
 * 契約の正本: `docs/superpowers/specs/2026-08-28-mock-transformer-contract.md`（親リポジトリ）
 * 候補カタログ・期待値の機械可読正本: `../src/testkit/mockContractFixture.js`
 *
 * import は package 境界を越えない相対パスで行う。Daedalus 自身のテストであるため
 * 契約違反ではない（Teiresias 側からの package 境界越し import のみが禁止される）。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  mockTransformer,
  throwingMockTransformer,
  brokenLengthMockTransformer,
  type MockGeoBasis,
} from '../src/testkit/mockTransformer.js';
import {
  candidateIds,
  candidateDefinitions,
  planeAId,
  planeBId,
  geoBasisLonLat,
  contractPoints,
  expectedPlaneA,
  expectedPlaneB,
  emptyPoints,
  nonFinitePoints,
  outOfBboxPoints,
  unknownId,
} from '../src/testkit/mockContractFixture.js';

const TOLERANCE = 1e-9;

const planarBasis: MockGeoBasis = { kind: 'planar_xy', axisOrder: 'xy', unit: 'm' };

const expectPointsClose = (
  actual: ReadonlyArray<readonly [number, number]>,
  expected: ReadonlyArray<readonly [number, number]>,
): void => {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(Math.abs(actual[i][0] - expected[i][0])).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(actual[i][1] - expected[i][1])).toBeLessThanOrEqual(TOLERANCE);
  }
};

describe('CandidateTransformer 契約（Daedalus testkit mock）', () => {
  it('contract(1): candidate ids are authority:code', () => {
    const idPattern = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
    for (const id of candidateIds) {
      expect(id).toMatch(idPattern);
      // 最初の ':' で分解し、authority / code がともに非空であること。
      const separatorIndex = id.indexOf(':');
      const authority = id.slice(0, separatorIndex);
      const code = id.slice(separatorIndex + 1);
      expect(authority.length).toBeGreaterThan(0);
      expect(code.length).toBeGreaterThan(0);
      // 再合成して元の id と一致すること。
      expect(`${authority}:${code}`).toBe(id);
    }
    // カタログ（candidateDefinitions）の id 集合が candidateIds と一致すること。
    expect(candidateDefinitions.map((definition) => definition.id)).toEqual([...candidateIds]);
  });

  it('contract(2)(3): output preserves order and count, [easting,northing]', () => {
    const planeA = mockTransformer(planeAId, contractPoints, geoBasisLonLat);
    const planeB = mockTransformer(planeBId, contractPoints, geoBasisLonLat);

    expect(planeA).not.toBeNull();
    expect(planeB).not.toBeNull();
    expectPointsClose(planeA as ReadonlyArray<readonly [number, number]>, expectedPlaneA);
    expectPointsClose(planeB as ReadonlyArray<readonly [number, number]>, expectedPlaneB);

    // 同順同数（入力 i 番目の変換結果が出力 i 番目）。
    expect(planeA).toHaveLength(contractPoints.length);
    expect(planeB).toHaveLength(contractPoints.length);
    // PLANE-A と PLANE-B は非等方性により明確に区別できる。
    expect(planeA).not.toEqual(planeB);
  });

  it('contract(4): empty input returns null', () => {
    expect(mockTransformer(planeAId, emptyPoints, geoBasisLonLat)).toBeNull();
    // `[]` を返さないこと（null であること）を明示的に確認する。
    expect(mockTransformer(planeAId, emptyPoints, geoBasisLonLat)).not.toEqual([]);
  });

  it('contract(5): any non-finite point nullifies whole result', () => {
    // 部分成功（先頭の有限点だけ変換した配列）を返さないこと。
    expect(mockTransformer(planeAId, nonFinitePoints, geoBasisLonLat)).toBeNull();
    expect(mockTransformer(planeBId, nonFinitePoints, geoBasisLonLat)).toBeNull();
  });

  it('contract(5)(7): out-of-bbox point nullifies whole result', () => {
    expect(mockTransformer(planeAId, outOfBboxPoints, geoBasisLonLat)).toBeNull();
    expect(mockTransformer(planeBId, outOfBboxPoints, geoBasisLonLat)).toBeNull();
  });

  it('contract(7): business-impossible returns null, never throws', () => {
    // 未知 id は業務的不能 → null
    expect(mockTransformer(unknownId, contractPoints, geoBasisLonLat)).toBeNull();
    // 対応外 geoBasis（planar_xy）は業務的不能 → null
    expect(mockTransformer(planeAId, contractPoints, planarBasis)).toBeNull();

    // null 系全入力に対して throw しないこと（適合実装は throw 分岐を持たない）。
    expect(() => mockTransformer(unknownId, contractPoints, geoBasisLonLat)).not.toThrow();
    expect(() => mockTransformer(planeAId, contractPoints, planarBasis)).not.toThrow();
    expect(() => mockTransformer(planeAId, emptyPoints, geoBasisLonLat)).not.toThrow();
    expect(() => mockTransformer(planeAId, nonFinitePoints, geoBasisLonLat)).not.toThrow();
    expect(() => mockTransformer(planeAId, outOfBboxPoints, geoBasisLonLat)).not.toThrow();
  });

  it('contract(8): deterministic across calls', () => {
    const first = mockTransformer(planeBId, contractPoints, geoBasisLonLat);
    const second = mockTransformer(planeBId, contractPoints, geoBasisLonLat);
    expect(first).toEqual(second);

    const firstNull = mockTransformer(unknownId, contractPoints, geoBasisLonLat);
    const secondNull = mockTransformer(unknownId, contractPoints, geoBasisLonLat);
    expect(firstNull).toEqual(secondNull);
  });

  it('package shape: exports has only "."', () => {
    // package 境界の機械的担保（設計 K1）: exports にサブパスが増えたら RED になる。
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(packageJson.exports)).toEqual(['.']);
  });

  it('contract violation simulators stay broken (fixture for m1-t1)', () => {
    // throwingMockTransformer: 入力によらず常に throw（契約(7) の adapter bug シミュレータ）
    expect(() => throwingMockTransformer(planeAId, contractPoints, geoBasisLonLat)).toThrow();
    expect(() => throwingMockTransformer(unknownId, emptyPoints, geoBasisLonLat)).toThrow();

    // brokenLengthMockTransformer: 成功経路でのみ末尾 1 点を欠く（契約(6) の長さ不一致シミュレータ）
    const broken = brokenLengthMockTransformer(planeAId, contractPoints, geoBasisLonLat);
    expect(broken).not.toBeNull();
    expect(broken).toHaveLength(contractPoints.length - 1);
    // 残った点は適合 mock の出力と一致する（長さだけが違反）。
    expectPointsClose(
      broken as ReadonlyArray<readonly [number, number]>,
      expectedPlaneA.slice(0, contractPoints.length - 1),
    );

    // null 経路では mockTransformer と同じく null（未定義域を作らない。設計 K13）。
    expect(brokenLengthMockTransformer(planeAId, emptyPoints, geoBasisLonLat)).toBeNull();
    expect(brokenLengthMockTransformer(unknownId, contractPoints, geoBasisLonLat)).toBeNull();
    expect(brokenLengthMockTransformer(planeAId, outOfBboxPoints, geoBasisLonLat)).toBeNull();
  });
});

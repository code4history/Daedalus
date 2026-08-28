/**
 * CandidateTransformer 契約（`docs/superpowers/specs/2026-08-28-mock-transformer-contract.md`）の
 * Daedalus 側 **参照実装**（決定的 mock）と、契約違反シミュレータ 2 種。
 *
 * 【型を import しない理由】
 * `CandidateTransformer` 型は Teiresias の所有物であり、Daedalus は Atlas / Teiresias を
 * 参照しない（依存方向 C1）。∴ ここでは **構造的に同形のローカル型**を宣言する。
 *
 * 【候補定義の正本】
 * 候補 id・写像係数・原点・有効域 bbox の機械可読正本は `./mockContractFixture.js` の
 * `candidateDefinitions` であり、本ファイルはそれを import して実装する（数値の二重定義を
 * 作らない。設計 K12）。判定順序（分岐）の正本は本ファイルである。
 *
 * 【package 境界】
 * 本ディレクトリ `src/testkit/` は `package.json` の `exports` に掲載されず（`"."` のみ）、
 * `tsconfig.build.json` により `dist/` へ emit もされない。∴ Teiresias から
 * `@c4h/daedalus/testkit` としても `@c4h/daedalus/dist/testkit/...` としても import できない
 * （設計 K1 / K2）。Teiresias は fixture を **ファイルコピー**して使う。
 */
import { candidateDefinitions } from './mockContractFixture.js';

/** Teiresias 側 `GeoBasis` と構造同形のローカル型（写し。import しない）。 */
export type MockGeoBasis =
  | { kind: 'lonlat_deg'; axisOrder: 'lon-lat'; datumNote?: string }
  | { kind: 'planar_xy'; axisOrder: 'xy'; unit: 'm' | 'ft'; note?: string };

/**
 * Teiresias 側 `CandidateTransformer` と構造同形のローカル型。
 * 契約上は `MaybePromise` 返却も適合だが、参照実装は決定性検証を最も単純にする
 * **同期返却**（`MaybePromise` の T 側）とする（設計 K10）。
 */
export type MockCandidateTransformer = (
  id: string,
  points: ReadonlyArray<readonly [number, number]>,
  geoBasis: MockGeoBasis,
) => Array<[number, number]> | null;

const isSupportedBasis = (geoBasis: MockGeoBasis): boolean =>
  geoBasis.kind === 'lonlat_deg' && geoBasis.axisOrder === 'lon-lat';

/**
 * 契約適合の参照実装。
 *
 * 判定順序（上から評価し最初に該当した分岐で確定）:
 *  1. `points.length === 0`                              -> null   契約(4)
 *  2. geoBasis が lonlat_deg / lon-lat でない            -> null   契約(7)・設計 K4
 *  3. id がカタログに無い（書式不正を含む）              -> null   契約(7)・設計 K4
 *  4. いずれかの点の lon/lat が非有限                    -> null   契約(5)（部分成功なし）
 *  5. いずれかの点が候補の有効域 bbox 外                 -> null   契約(5)(7)・設計 K4
 *  6. 上記以外 -> 全点を写像した `Array<[E,N]>`（同順同数）契約(2)(3)(8)
 *
 * **throw する分岐を持たない。** 契約(7) のとおり、適合実装は業務的不能をすべて null で
 * 表現する。throw を行うのは違反シミュレータ `throwingMockTransformer` だけである。
 *
 * 決定性（契約(8)）: 乱数・時刻・外部 IO・共有可変状態を参照しない純関数。
 */
export const mockTransformer: MockCandidateTransformer = (id, points, geoBasis) => {
  // 1. 空入力
  if (points.length === 0) {
    return null;
  }

  // 2. 対応外 geoBasis（mock は planar_xy 経路をモデル化しない）
  if (!isSupportedBasis(geoBasis)) {
    return null;
  }

  // 3. 未知 id（カタログに無い / 書式不正）
  const definition = candidateDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    return null;
  }

  const [lon0, lat0] = definition.origin;
  const { west, south, east, north } = definition.bbox;
  const result: Array<[number, number]> = [];

  for (const point of points) {
    const [lon, lat] = point;

    // 4. 非有限（一点でも該当したら全体 null。部分配列・null 埋めを返さない）
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return null;
    }

    // 5. 有効域 bbox 外（境界は含む）
    if (lon < west || lon > east || lat < south || lat > north) {
      return null;
    }

    // 6. 写像（単位はメートル相当の平面座標。出力は [easting, northing] 順）
    const dLon = lon - lon0;
    const dLat = lat - lat0;
    result.push([
      definition.eLon * dLon + definition.eLat * dLat,
      definition.nLon * dLon + definition.nLat * dLat,
    ]);
  }

  return result;
};

/**
 * 違反シミュレータ（契約(7) の「adapter bug」）。
 * **入力によらず常に throw する**（null 系入力を含む全入力域で定義済み。設計 K13）。
 * m1-t1 の失敗系テスト（AC-m1-3）で「throw する adapter」を注入するために使う。
 */
export const throwingMockTransformer: MockCandidateTransformer = () => {
  throw new Error('mock adapter bug: throwingMockTransformer always throws');
};

/**
 * 違反シミュレータ（契約(6) の長さ不一致）。
 * `mockTransformer` と**同一の判定順序**を評価し、`mockTransformer` が配列を返す入力に対して
 * **のみ**末尾 1 点を欠いた配列を返す。null を返す入力には同じく null を返す（設計 K13）。
 * ∴ 違反注入は成功経路に限られ、空入力で `length - 1 = -1` という未定義域は発生しない。
 */
export const brokenLengthMockTransformer: MockCandidateTransformer = (id, points, geoBasis) => {
  const conforming = mockTransformer(id, points, geoBasis);
  if (conforming === null) {
    return null;
  }
  return conforming.slice(0, conforming.length - 1);
};

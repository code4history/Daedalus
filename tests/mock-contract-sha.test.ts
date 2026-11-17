import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The mock contract fixture is the source of the copy Teiresias keeps in its own tests.
// Both repositories check their file against the same SHA-256 (fixtureVersion 1.0.2), so
// the two files stay identical without either repository reading the other.
const SPECIFIED_SHA256 = 'ceea43136ab476c8165bb1fd7db6764232815c6871969b67adec3cf8fd2a69cc';

const fixture = fileURLToPath(new URL('../src/testkit/mockContractFixture.ts', import.meta.url));

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('mock contract fixture', () => {
  it('has the specified SHA-256', () => {
    expect(sha256(readFileSync(fixture))).toBe(SPECIFIED_SHA256);
  });

  it('the check fails when a single byte changes', () => {
    const changed = Buffer.concat([readFileSync(fixture), Buffer.from('\n')]);
    expect(sha256(changed)).not.toBe(SPECIFIED_SHA256);
  });
});

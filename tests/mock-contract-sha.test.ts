import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The mock contract fixture is the source of the copy Teiresias keeps in its own tests.
// Both repositories check their file against the same SHA-256 (fixtureVersion 1.0.1), so
// the two files stay identical without either repository reading the other.
const SPECIFIED_SHA256 = '5da3d253e46a0dc6f8710432fc0783a261fbb35ca0c47757b0b204a48fa85495';

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

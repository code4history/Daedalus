import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Daedalus has no dependencies, so its CI checks out this repository alone and runs on
// every branch. deploy.yml runs only on pushes to master; the test job installs the same
// way (pnpm version, CI pnpm settings, frozen lockfile) so that an install problem shows
// up on the pull request instead of after the merge.

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), 'utf8');

/** The lines that decide how dependencies are installed. */
function installLines(workflow: string): string[] {
  return workflow
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^version:\s*\S/.test(line) ||
        /^run:\s*cp ci\/pnpm-workspace\.ci\.yaml pnpm-workspace\.yaml$/.test(line) ||
        /^run:\s*pnpm install\b/.test(line) ||
        /^uses:\s*pnpm\/action-setup@/.test(line),
    );
}

function nodeVersions(workflow: string): string[] {
  const matrix = workflow.match(/node-version:\s*\[([^\]]*)\]/);
  if (matrix) return matrix[1].split(',').map((v) => v.trim());
  return [...workflow.matchAll(/node-version:\s*(\d+)\s*$/gm)].map((m) => m[1]);
}

describe('test.yml', () => {
  const test = read('test.yml');

  it('runs the checks that prepublishOnly runs', () => {
    for (const script of ['test', 'typecheck', 'test:types', 'build', 'verify:demo']) {
      expect(test).toContain(`pnpm run ${script}`);
    }
  });

  it('runs on every branch and checks out this repository alone', () => {
    expect(test).not.toContain('branches:');
    expect(test).not.toContain('repository: code4history/');
  });

  it('installs with the CI pnpm settings and the frozen lockfile', () => {
    expect(test).toContain('run: cp ci/pnpm-workspace.ci.yaml pnpm-workspace.yaml');
    expect(test).toContain('run: pnpm install --frozen-lockfile');
  });

  it('starts from read-only permissions', () => {
    expect(test).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(test).not.toContain('id-token: write');
  });
});

describe('deploy.yml and test.yml install the same way', () => {
  const test = read('test.yml');
  const deploy = read('deploy.yml');

  it('finds the install lines in deploy.yml', () => {
    expect(installLines(deploy).length).toBeGreaterThanOrEqual(4);
  });

  it('uses the same install lines', () => {
    expect([...new Set(installLines(test))]).toEqual([...new Set(installLines(deploy))]);
  });

  it('tests on the Node.js version deploy.yml builds with', () => {
    const deployNode = nodeVersions(deploy);
    expect(deployNode.length).toBe(1);
    expect(nodeVersions(test)).toContain(deployNode[0]);
  });
});

describe('every workflow', () => {
  for (const name of ['test.yml', 'deploy.yml', 'publish.yml']) {
    it(`${name} pins every action by commit SHA`, () => {
      const uses = read(name)
        .split('\n')
        .filter((line) => /^\s*-?\s*uses:/.test(line));
      expect(uses.length).toBeGreaterThan(0);
      expect(uses.filter((line) => !/@[0-9a-f]{40}(\s|$)/.test(line))).toEqual([]);
    });
  }
});

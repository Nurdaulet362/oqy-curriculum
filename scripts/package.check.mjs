import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packageProject } from './package.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oqy-package-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['dist', 'artifacts', 'docs', 'public']) mkdirSync(join(root, directory));
  for (const [file, content] of Object.entries({ 'dist/index.html': 'current build', 'public/pitch.html': 'deck', 'README.md': 'readme', 'HANDOFF.md': 'handoff' })) writeFileSync(join(root, file), content);
  return root;
}
const archiveNames = file => JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))', file], { encoding: 'utf8' }));

test('repackaging excludes stale files and assets in the previous expanded release', t => {
  const root = fixture(t);
  packageProject(root);
  writeFileSync(join(root, 'release/OQY/dist/stale-private.csv'), 'SENTINEL');
  writeFileSync(join(root, 'release/OQY/dist/old-build.js'), 'old');
  const file = packageProject(root);
  const names = archiveNames(file);
  assert.ok(names.includes('OQY/dist/index.html'));
  assert.ok(!names.some(name => name.includes('stale-private') || name.includes('old-build')));
  assert.equal(existsSync(join(root, 'release/OQY/dist/stale-private.csv')), false);
});

test('failed packaging preserves the last completed ZIP and expanded release', t => {
  const root = fixture(t);
  const file = packageProject(root);
  const original = readFileSync(file);
  rmSync(join(root, 'HANDOFF.md'));
  assert.throws(() => packageProject(root));
  assert.deepEqual(readFileSync(file), original);
  assert.equal(readFileSync(join(root, 'release/OQY/dist/index.html'), 'utf8'), 'current build');
});

test('release includes independently verifiable build provenance without requiring Git', t => {
  const root = fixture(t);
  packageProject(root);
  const version = JSON.parse(readFileSync(join(root, 'release/OQY/VERSION.json'), 'utf8'));
  assert.equal(version.sourceCommit, null);
  assert.equal(version.sourceDirty, null);
  assert.equal(version.buildFilesSha256['index.html'], createHash('sha256').update('current build').digest('hex'));
  assert.ok(archiveNames(join(root, 'release/OQY-demo.zip')).includes('OQY/VERSION.json'));
  const manifest = JSON.parse(readFileSync(join(root, 'release/OQY/MANIFEST.json'), 'utf8'));
  for (const [file, hash] of Object.entries(manifest.filesSha256)) assert.equal(createHash('sha256').update(readFileSync(join(root, 'release/OQY', file))).digest('hex'), hash);
  assert.match(readFileSync(join(root, 'release/OQY/README.md'), 'utf8'), /python3 start.py/);
  assert.equal(readFileSync(join(root, 'release/OQY/SOURCE-README.md'), 'utf8'), 'readme');
  const launcher = readFileSync(join(root, 'release/OQY/start.py'), 'utf8');
  assert.match(launcher, /OQY_PORT/);
});

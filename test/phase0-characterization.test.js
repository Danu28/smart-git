const test = require('node:test');
const assert = require('node:assert');
const fs2 = require('node:fs');
const path = require('node:path');

test('Phase0: clean vs tidy protected patterns unified via shared constants', () => {
  const cleanSrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/clean.js'), 'utf8');
  const tidySrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/tidy.js'), 'utf8');
  const constantsSrc = fs2.readFileSync(path.join(__dirname, '..', 'src/utils/constants.js'), 'utf8');
  assert.ok(cleanSrc.includes("utils/constants"), 'clean.js imports from constants');
  assert.ok(tidySrc.includes("utils/constants"), 'tidy.js imports from constants');
  assert.ok(cleanSrc.includes("isProtected"), 'clean uses isProtected');
  assert.ok(tidySrc.includes("isProtected"), 'tidy uses isProtected');
  assert.ok(constantsSrc.includes("PROTECTED_PATTERNS"), 'constants has PROTECTED_PATTERNS');
  assert.ok(constantsSrc.includes(".env"), 'constants has .env pattern');
  assert.ok(constantsSrc.includes("credentials"), 'constants has credentials pattern');
  assert.ok(!cleanSrc.includes("const PROTECTED = ["), 'clean should not have inline PROTECTED');
  const tidyHasInlineProtected = cleanSrc.includes("const PROTECTED = [") || tidySrc.includes("const PROTECTED = [");
  // Actually check tidy specifically via string includes
  assert.strictEqual(tidySrc.includes("const PROTECTED = ["), false, 'tidy should not have inline PROTECTED');
  console.log('  clean/tidy unified via constants OK');
});

test('Phase0: branch prune filter uses shared DEFAULT_PROTECTED_BRANCHES', () => {
  const branchSrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/branch.js'), 'utf8');
  const tidySrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/tidy.js'), 'utf8');
  const cleanupSrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/cleanup.js'), 'utf8');
  const constantsSrc = fs2.readFileSync(path.join(__dirname, '..', 'src/utils/constants.js'), 'utf8');
  assert.ok(constantsSrc.includes("DEFAULT_PROTECTED_BRANCHES"), 'constants has denylist');
  assert.ok(branchSrc.includes("DEFAULT_PROTECTED_BRANCHES"), 'branch.js uses shared denylist');
  assert.ok(tidySrc.includes("DEFAULT_PROTECTED_BRANCHES"), 'tidy.js uses shared denylist');
  assert.ok(cleanupSrc.includes("DEFAULT_PROTECTED_BRANCHES"), 'cleanup.js uses shared denylist');
  console.log('  denylist unified via constants OK');
});

test('Phase0: tidy --untracked duplicates clean preview logic (characterization)', () => {
  const tidySrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/tidy.js'), 'utf8');
  assert.ok(tidySrc.includes("clean -n -d"), 'tidy duplicates clean preview');
  assert.ok(tidySrc.includes("Would remove"), 'tidy duplicates Would remove parsing');
});

test('Phase0: commit.js tmp file uses crypto.randomUUID (collision-safe)', () => {
  const commitSrc = fs2.readFileSync(path.join(__dirname, '..', 'src/commands/commit.js'), 'utf8');
  assert.ok(commitSrc.includes("crypto.randomUUID"), 'commit uses crypto.randomUUID');
  assert.ok(commitSrc.includes("mode: 0o600"), 'commit uses secure mode 0o600');
  assert.ok(!commitSrc.includes("Date.now"), 'commit should not use Date.now for tmp');
});

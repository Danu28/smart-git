const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { shellSplit } = require('../src/utils/git.js');

test('shellSplit: Windows temp path in double quotes keeps backslashes', () => {
  const t = shellSplit('commit -F "C:\\Users\\x\\AppData\\Local\\Temp\\msg.txt" --amend');
  assert.deepStrictEqual(t, ['commit', '-F', 'C:\\Users\\x\\AppData\\Local\\Temp\\msg.txt', '--amend']);
});

test('shellSplit: escaped quotes inside double quotes become literal quotes', () => {
  const t = shellSplit('stash push -m "say \\"hi\\" ok"');
  assert.deepStrictEqual(t, ['stash', 'push', '-m', 'say "hi" ok']);
});

test('shellSplit: pretty format with spaces stays one token', () => {
  const t = shellSplit('log --graph --pretty=format:"%h %an %s" --date=short -n 15');
  assert.deepStrictEqual(t, ['log', '--graph', '--pretty=format:%h %an %s', '--date=short', '-n', '15']);
});

test('shellSplit: single quotes are literal (no interpolation)', () => {
  const t = shellSplit("commit -m '$HOME & $(rm -rf /)'");
  assert.deepStrictEqual(t, ['commit', '-m', '$HOME & $(rm -rf /)']);
});

test('shellSplit: revision range braces are preserved', () => {
  assert.deepStrictEqual(shellSplit('rev-list --left-right --count HEAD...@{u}'), ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
});

test('shellSplit: shell metacharacters are never split', () => {
  assert.deepStrictEqual(shellSplit('commit -m "a & b | c; d $e"'), ['commit', '-m', 'a & b | c; d $e']);
});

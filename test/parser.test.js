const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStacktrace } = require('../src/parser');

test('JS stacktrace with file:line:col dedupes', () => {
  const t = 'Error\n at foo (src/app.js:42:10)\n at foo (src/app.js:42:10)\n at bar (src/app.js:10:5)';
  const r = parseStacktrace(t);
  assert.deepEqual(r, [{file:'src/app.js', line:42}, {file:'src/app.js', line:10}]);
});

test('Python File line', () => {
  assert.deepEqual(parseStacktrace('File "app.py", line 123'), [{file:'app.py', line:123}]);
  assert.deepEqual(parseStacktrace('File "./src/util.py", line 7'), [{file:'src/util.py', line:7}]);
});

test('ignores node_modules', () => {
  const r = parseStacktrace(' at foo (node_modules/foo/index.js:5:3)\n at bar (src/app.js:1:2)');
  assert.deepEqual(r, [{file:'src/app.js', line:1}]);
});

test('Java and Go', () => {
  const r = parseStacktrace('at com.example.Foo.bar(Foo.java:99)\n src/main.go:27');
  assert.ok(r.some(x=>x.file.endsWith('Foo.java') && x.line===99));
  assert.ok(r.some(x=>x.file.endsWith('main.go') && x.line===27));
});

test('empty returns empty', () => {
  assert.deepEqual(parseStacktrace('no stack here'), []);
});

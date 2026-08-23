const { execFileSync } = require('child_process');

// Run git with an argv array (no shell) — kills the command-injection class.
function g(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], ...opts }).trim();
  } catch (e) {
    const out = (e.stdout||'') + (e.stderr||'');
    throw new Error(out.trim() || e.message);
  }
}

function isSafeHash(h) { return /^[0-9a-f]{7,40}$/i.test(h); }
function assertSafeHash(h) { if (!isSafeHash(h)) throw new Error('Invalid hash: ' + h); }

function gitRoot(cwd) {
  return g(['rev-parse', '--show-toplevel'], cwd ? { cwd } : {});
}

function blame(file, line, root) {
  const n = Number(line); if (!Number.isInteger(n) || n < 1 || n > 1000000) return null;
  try {
    const out = g(['blame', '--porcelain', '-L', n + ',' + n, '--', file], { cwd: root });
    const m = out.match(/^([0-9a-f]{40})/m);
    return m ? m[1] : null;
  } catch { return null; }
}

function commitInfo(hash, root) {
  assertSafeHash(hash);
  const out = g(['show', '--no-patch', '--format=%H%x1f%an%x1f%ai%x1f%s', hash], { cwd: root });
  const [h, author, date, msg] = out.split('\x1f');
  return { hash: h.slice(0,12), fullHash: h, author, date, message: msg };
}

function snippet(hash, file, root) {
  assertSafeHash(hash);
  try {
    const out = g(['show', hash, '--', file], { cwd: root });
    return out.split('\n').slice(0,120).join('\n');
  } catch { return ''; }
}

function isWhitespaceOnly(hash, file, root) {
  assertSafeHash(hash);
  try {
    const diff = g(['show', '--ignore-all-space', '--ignore-blank-lines', '--format=', hash, '--', file], { cwd: root });
    const lines = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'));
    const content = lines.filter(l => !l.startsWith('+++') && !l.startsWith('---'));
    return content.length === 0;
  } catch { return false; }
}

function lineAt(commit, file, line, root) {
  const out = g(['show', commit + ':' + file], { cwd: root });
  return (out.split('\n')[line - 1] || '').trim();
}

function szzOrigin(file, line, blameHash, root) {
  assertSafeHash(blameHash);
  let content = '';
  try { content = lineAt(blameHash, file, line, root); } catch {}
  // pipe-less: content is passed as a safe argv element; bail on too-short lines
  if (!content || content.length < 3) return blameHash;
  try {
    const hashes = g(['log', '--reverse', '--diff-filter=A', '--format=%H', '--all', '-S', content, '--', file], { cwd: root });
    const all = g(['log', '--reverse', '--format=%H', '--all', '-G', content, '--', file], { cwd: root });
    const list = (hashes || all).split('\n').filter(Boolean);
    if (list.length) {
      const first = list[0].trim();
      if (isSafeHash(first)) return first;
    }
  } catch {}
  return blameHash;
}

function worktreeAdd(hash, dest, root) {
  assertSafeHash(hash);
  g(['worktree', 'add', '--detach', dest, hash], { cwd: root });
}
function worktreeRemove(dest, root) {
  g(['worktree', 'remove', '--force', dest], { cwd: root });
}
function worktreeList(root) {
  try { return g(['worktree', 'list', '--porcelain'], { cwd: root }); } catch { return ''; }
}

module.exports = { g, gitRoot, blame, commitInfo, snippet, isWhitespaceOnly, szzOrigin, worktreeAdd, worktreeRemove, worktreeList };
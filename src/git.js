const { execSync } = require('child_process');

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], ...opts }).trim();
  } catch (e) {
    const out = (e.stdout||'') + (e.stderr||'');
    throw new Error(out.trim() || e.message);
  }
}

function isSafeHash(h) { return /^[0-9a-f]{7,40}$/i.test(h); }
function assertSafeHash(h) { if (!isSafeHash(h)) throw new Error('Invalid hash: ' + h); }

function gitRoot(cwd) {
  return sh('git rev-parse --show-toplevel', cwd ? { cwd } : {});
}

function isTracked(file, root) {
  if (file.includes('\n') || file.includes('\0')) return false;
  try { sh(`git ls-files --error-unmatch -- "${file.replace(/"/g,'\\"')}"`, { cwd: root }); return true; }
  catch { return false; }
}

function blame(file, line, root) {
  const n = Number(line); if (!Number.isInteger(n) || n < 1 || n > 1000000) return null;
  const out = sh(`git blame --porcelain -L ${n},${n} -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
  const m = out.match(/^([0-9a-f]{40})/m);
  return m ? m[1] : null;
}

function commitInfo(hash, root) {
  assertSafeHash(hash);
  const fmt = '%H%x1f%an%x1f%ai%x1f%s';
  const out = sh(`git show --no-patch --format="${fmt}" ${hash}`, { cwd: root });
  const [h, author, date, msg] = out.split('\x1f');
  return { hash: h.slice(0,12), fullHash: h, author, date, message: msg };
}

function snippet(hash, file, root) {
  assertSafeHash(hash);
  try {
    const out = sh(`git show ${hash} -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    return out.split('\n').slice(0,120).join('\n');
  } catch { return ''; }
}

function isWhitespaceOnly(hash, file, root) {
  assertSafeHash(hash);
  try {
    const diff = sh(`git show --ignore-all-space --ignore-blank-lines --format="" ${hash} -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    const lines = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'));
    const content = lines.filter(l => !l.startsWith('+++') && !l.startsWith('---'));
    return content.length === 0;
  } catch { return false; }
}

function szzOrigin(file, line, blameHash, root) {
  assertSafeHash(blameHash);
  let content = '';
  try { content = sh(`git show ${blameHash}:"${file.replace(/"/g,'\\"')}" | sed -n '${line}p'`, { cwd: root }); } catch {}
  content = content.trim();
  if (!content || content.length < 3) return blameHash;
  const risky = [String.fromCharCode(34), String.fromCharCode(96), String.fromCharCode(36), String.fromCharCode(59), String.fromCharCode(92), String.fromCharCode(10)].some(c => content.includes(c));
  if (risky) return blameHash;
  try {
    const hashes = sh(`git log --reverse --diff-filter=A --format="%H" --all -S "${content.replace(/"/g,'\\"')}" -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    const all = sh(`git log --reverse --format="%H" --all -G "${content.replace(/"/g,'\\"')}" -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    const list = (all || hashes).split('\n').filter(Boolean);
    if (list.length) {
      const first = list[0].trim();
      if (isSafeHash(first)) return first;
    }
  } catch {}
  return blameHash;
}

function worktreeAdd(hash, dest, root) {
  assertSafeHash(hash);
  if (dest.includes('"') || dest.includes('\n')) throw new Error('Invalid dest');
  sh(`git worktree add --detach "${dest}" ${hash}`, { cwd: root });
}
function worktreeRemove(dest, root) {
  if (dest.includes('"') || dest.includes('\n')) throw new Error('Invalid dest');
  sh(`git worktree remove --force "${dest}"`, { cwd: root });
}
function worktreeList(root) {
  try { return sh('git worktree list --porcelain', { cwd: root }); } catch { return ''; }
}

module.exports = { sh, gitRoot, isTracked, blame, commitInfo, snippet, isWhitespaceOnly, szzOrigin, worktreeAdd, worktreeRemove, worktreeList };

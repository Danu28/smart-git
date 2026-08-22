const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], ...opts }).trim();
  } catch (e) {
    const out = (e.stdout||'') + (e.stderr||'');
    throw new Error(out.trim() || e.message);
  }
}

function gitRoot(cwd) {
  return sh('git rev-parse --show-toplevel', cwd ? { cwd } : {});
}

function isTracked(file, root) {
  try { sh(`git ls-files --error-unmatch -- "${file.replace(/"/g,'\\"')}"`, { cwd: root }); return true; }
  catch { return false; }
}

function blame(file, line, root) {
  // porcelain gives hash per line
  const out = sh(`git blame --porcelain -L ${line},${line} -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
  const m = out.match(/^([0-9a-f]{40})/m);
  return m ? m[1] : null;
}

function commitInfo(hash, root) {
  const fmt = '%H%x1f%an%x1f%ai%x1f%s';
  const out = sh(`git show --no-patch --format="${fmt}" ${hash}`, { cwd: root });
  const [h, author, date, msg] = out.split('\x1f');
  return { hash: h.slice(0,12), fullHash: h, author, date, message: msg };
}

function snippet(hash, file, root) {
  try { return sh(`git show ${hash} -- "${file.replace(/"/g,'\\"')}" | head -n 120`, { cwd: root }); } catch { return ''; }
}

function isWhitespaceOnly(hash, file, root) {
  try {
    const diff = sh(`git show --ignore-all-space --ignore-blank-lines --format="" ${hash} -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    // if diff has no +/- beyond header, treat as whitespace
    const lines = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-'));
    // filter header lines +++ / ---
    const content = lines.filter(l => !l.startsWith('+++') && !l.startsWith('---'));
    return content.length === 0;
  } catch { return false; }
}

function szzOrigin(file, line, blameHash, root) {
  // SZZ lite: walk log -S / -G for the line's content origin
  // Get line content at blame commit
  let content = '';
  try { content = sh(`git show ${blameHash}:"${file.replace(/"/g,'\\"')}" | sed -n '${line}p'`, { cwd: root }); } catch {}
  content = content.trim();
  if (!content || content.length < 3) return blameHash; // too short to SZZ
  // Find commits that added this string
  try {
    const hashes = sh(`git log --reverse --diff-filter=A --format="%H" --all -S "${content.replace(/"/g,'\\"')}" -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    // actually use pickaxe -G for all, then pick earliest
    const all = sh(`git log --reverse --format="%H" --all -G "${content.replace(/"/g,'\\"')}" -- "${file.replace(/"/g,'\\"')}"`, { cwd: root });
    const list = (all || hashes).split('\n').filter(Boolean);
    if (list.length) return list[0];
  } catch {}
  return blameHash;
}

function worktreeAdd(hash, dest, root) {
  sh(`git worktree add --detach "${dest}" ${hash}`, { cwd: root });
}
function worktreeRemove(dest, root) {
  sh(`git worktree remove --force "${dest}"`, { cwd: root });
}
function worktreeList(root) {
  try { return sh('git worktree list --porcelain', { cwd: root }); } catch { return ''; }
}

module.exports = { sh, gitRoot, isTracked, blame, commitInfo, snippet, isWhitespaceOnly, szzOrigin, worktreeAdd, worktreeRemove, worktreeList };

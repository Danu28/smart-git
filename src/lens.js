const path = require('path');
const os = require('os');
const git = require('./git');
function preview(hash, opts = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('Invalid hash');
  const root = git.gitRoot();
  const tmp = path.join(os.tmpdir(), 'smart-git-lens-' + hash.slice(0,8) + '-' + Date.now());
  git.worktreeAdd(hash, tmp, root);
  return { root, hash, dest: tmp, snippet: git.g(['show', '--stat', hash], { cwd: root }).slice(0, 2000) };
}
function exitLens(dest) {
  if (!dest) {
    const root = git.gitRoot();
    const list = git.worktreeList(root);
    const lines = list.split(String.fromCharCode(10));
    for (const l of lines) { if (l.startsWith('worktree ') && l.includes('smart-git-lens')) { dest = l.slice(9).trim(); break; } }
  }
  if (!dest) throw new Error('No lens worktree found. Pass dest path.');
  const root = git.gitRoot();
  git.worktreeRemove(dest, root);
  return dest;
}
module.exports = { preview, exitLens };

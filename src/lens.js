const path = require('path');
const os = require('os');
const git = require('./git');
function preview(hash, opts = {}) {
  const root = git.gitRoot();
  const tmp = path.join(os.tmpdir(), 'smart-git-lens-' + hash.slice(0,8) + '-' + Date.now());
  git.worktreeAdd(hash, tmp, root);
  return { root, hash, dest: tmp, snippet: git.sh('git show --stat ' + hash, { cwd: root }).slice(0, 2000) };
}
function exitLens(dest) {
  if (!dest) {
    const root = git.gitRoot();
    const list = git.worktreeList(root);
    const lines = list.split(String.fromCharCode(10));
    for (const l of lines) { if (l.includes('smart-git-lens')) { dest = l.replace('worktree ','').trim(); break; } }
  }
  if (!dest) throw new Error('No lens worktree found. Pass dest path.');
  const root = git.gitRoot();
  git.worktreeRemove(dest, root);
  return dest;
}
module.exports = { preview, exitLens };

const fs = require('node:fs');
const path = require('node:path');
const { runGit } = require('./git');

// .gitignore helpers shared by `sg untrack` and `sg ignore`.

function getIgnorePath(cwd = process.cwd()) {
  return path.join(cwd, '.gitignore');
}

function readPatterns(cwd = process.cwd()) {
  try {
    return fs.readFileSync(getIgnorePath(cwd), 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Appends missing patterns; returns the split. Never duplicates.
function appendPatterns(patterns, cwd = process.cwd()) {
  const current = readPatterns(cwd);
  const set = new Set(current);
  const added = [];
  const existing = [];
  for (const p of patterns) {
    const norm = String(p).trim();
    if (!norm) continue;
    if (set.has(norm)) existing.push(norm);
    else { set.add(norm); added.push(norm); }
  }
  if (added.length) {
    fs.appendFileSync(getIgnorePath(cwd), (current.length ? '\n' : '') + added.join('\n') + '\n');
  }
  return { added, existing };
}

// Tracked paths an ignore pattern would hit (exact path or dir/ prefix).
// Lets `sg ignore` warn that the pattern needs `sg untrack` first.
function findTrackedMatches(pattern, cwd = process.cwd()) {
  const out = runGit('ls-files -z', { cwd, raw: true, allowError: true }) || '';
  const files = out.split('\u0000').filter(Boolean);
  const base = String(pattern).replace(/^\/+/, '');
  const dirPrefix = /\/$/.test(base) ? base : base + '/';
  return files.filter((f) => f === base || f.startsWith(dirPrefix));
}

function isDirectoryEntry(p, cwd = process.cwd()) {
  try { return fs.statSync(path.join(cwd, p)).isDirectory() && !String(p).endsWith('/') ? String(p) + '/' : String(p); } catch { return String(p); }
}

module.exports = { getIgnorePath, readPatterns, appendPatterns, findTrackedMatches, isDirectoryEntry };
const { spawnSync } = require('child_process');
const { UserError } = require('../errors');

/**
 * Tokenize a command string into argv array without shell.
 * Handles single/double quotes and backslash escaping.
 * @param {string} input
 * @returns {string[]}
 */
function shellSplit(input) {
  const tokens = [];
  let cur = '';
  let inS = false;
  let inD = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inS) {
      if (ch === "'") inS = false;
      else cur += ch;
    } else if (inD) {
      if (ch === '"') inD = false;
      else if (ch === '\\' && input[i + 1] === '"') { cur += '"'; i++; }
      else cur += ch;
    } else {
      if (ch === "'") inS = true;
      else if (ch === '"') inD = true;
      else if (ch === '\\' && i + 1 < input.length) { cur += input[i + 1]; i++; }
      else if (/\s/.test(ch)) { if (cur) { tokens.push(cur); cur = ''; } }
      else cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * @param {string} [cwd]
 * @returns {boolean}
 */
function isGitRepo(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
  return result.status === 0;
}

function ensureGitRepo() {
  if (!isGitRepo()) {
    throw new UserError('Not a git repository. Run `git init` first or cd into a repo.');
  }
}

/**
 * Run git with argv array or string (shellSplit). No shell.
 * @param {string|string[]} args
 * @param {Object} [options]
 */
function runGit(args, options = {}) {
  const { cwd = process.cwd(), silent: _silent = false, allowError = false, raw = false, env } = options; void _silent;
  const argv = Array.isArray(args) ? args : shellSplit(String(args));
  const spawnOpts = { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 };
  if (env) spawnOpts.env = { ...process.env, ...env };
  const result = spawnSync('git', argv, spawnOpts);
  if (result.error) {
    if (allowError) return null;
    throw new Error(result.error.message.trim());
  }
  if (result.status !== 0) {
    if (allowError) return null;
    const msg = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(msg || `git ${argv.join(' ')} failed (${result.status})`);
  }
  if (raw) return result.stdout || '';
  return (result.stdout || '').trim();
}

module.exports = { shellSplit, isGitRepo, ensureGitRepo, runGit };

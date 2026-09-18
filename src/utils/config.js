const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

// Conventional commit types with emojis and descriptions
const COMMIT_TYPES = [
  { name: 'feat:     A new feature', value: 'feat' },
  { name: 'fix:      A bug fix', value: 'fix' },
  { name: 'docs:     Documentation only', value: 'docs' },
  { name: 'style:    Formatting, no code change', value: 'style' },
  { name: 'refactor: Code change that neither fixes bug nor adds feature', value: 'refactor' },
  { name: 'perf:     Performance improvement', value: 'perf' },
  { name: 'test:     Adding missing tests', value: 'test' },
  { name: 'chore:    Maintenance, tooling', value: 'chore' },
  { name: 'build:    Build system / dependencies', value: 'build' },
  { name: 'ci:       CI configuration', value: 'ci' },
  { name: 'revert:   Revert previous commit', value: 'revert' },
];

const BRANCH_PREFIXES = ['feat/', 'fix/', 'chore/', 'docs/', 'refactor/', 'hotfix/', 'release/'];

function smartCommitMessage(type, scope, subject, body, breaking, issues) {
  let msg = type;
  if (scope) msg += `(${scope})`;
  msg += `: ${subject}`;
  if (body) msg += `\n\n${body}`;
  if (breaking) msg += `\n\nBREAKING CHANGE: ${breaking}`;
  if (issues) msg += `\n\nCloses ${issues}`;
  return msg;
}

// ── Config system: global + repo ────────────────────────────────────────
function globalConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'smart-git', 'config.json');
}
function repoConfigPath(cwd = process.cwd()) {
  return path.join(cwd, '.smartgitrc');
}
function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}
function loadAllConfig(cwd = process.cwd()) {
  const global = loadJson(globalConfigPath()) || {};
  const repo = loadJson(repoConfigPath(cwd)) || {};
  // repo overrides global
  return { ...global, ...repo, _globalPath: globalConfigPath(), _repoPath: repoConfigPath(cwd) };
}
function getConfig(key, cwd) {
  const all = loadAllConfig(cwd);
  return key ? all[key] : all;
}
function setConfig(key, value, opts = {}) {
  const useGlobal = opts.global || false;
  const p = useGlobal ? globalConfigPath() : repoConfigPath(opts.cwd || process.cwd());
  const cur = loadJson(p) || {};
  if (value === undefined) delete cur[key];
  else cur[key] = value;
  saveJson(p, cur);
  return cur;
}
function initConfig(cwd = process.cwd()) {
  const defaults = {
    branchPrefixes: BRANCH_PREFIXES,
    ticketRegex: '',
    aiProvider: '',
    autoStash: true,
    protectedPatterns: []
  };
  const p = repoConfigPath(cwd);
  if (!fs.existsSync(p)) saveJson(p, defaults);
  return loadAllConfig(cwd);
}

module.exports = { COMMIT_TYPES, BRANCH_PREFIXES, smartCommitMessage, globalConfigPath, repoConfigPath, loadAllConfig, getConfig, setConfig, initConfig };

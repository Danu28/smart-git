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

function inferTypeFromDiff(diffStat) {
  const lower = diffStat.toLowerCase();
  if (lower.includes('readme') || lower.includes('.md')) return 'docs';
  if (lower.includes('test') || lower.includes('spec')) return 'test';
  if (lower.includes('fix') || lower.includes('bug')) return 'fix';
  return 'feat';
}

module.exports = { COMMIT_TYPES, BRANCH_PREFIXES, smartCommitMessage, inferTypeFromDiff };

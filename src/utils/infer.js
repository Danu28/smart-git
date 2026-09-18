// Inference helpers for Smart Commit v2 — type/scope from diff + branch
const path = require('path');

function inferTypeFromBranch(branch) {
  if (!branch) return null;
  const b = branch.toLowerCase();
  if (/(fix|bug|hotfix)/.test(b)) return 'fix';
  if (/(feat|feature)/.test(b)) return 'feat';
  if (/docs/.test(b)) return 'docs';
  if (/chore/.test(b)) return 'chore';
  if (/refactor/.test(b)) return 'refactor';
  if (/perf/.test(b)) return 'perf';
  return null;
}

function inferTypeFromFiles(files) {
  if (!files || !files.length) return null;
  const allMd = files.every(f => f.endsWith('.md'));
  if (allMd) return 'docs';
  const hasTest = files.some(f => f.includes('.test.') || f.includes('__tests__') || f.includes('/test/'));
  if (hasTest && files.every(f => f.includes('.test.') || f.includes('__tests__') || f.includes('/test/'))) return 'test';
  if (files.some(f => f.includes('.github/workflows') || f.includes('ci.yml'))) return 'ci';
  if (files.some(f => f.startsWith('src/') || f.startsWith('lib/'))) return 'feat';
  return null;
}

function inferScopeFromFiles(files) {
  if (!files || !files.length) return '';
  // common prefix under src/
  const srcFiles = files.filter(f => f.startsWith('src/'));
  if (srcFiles.length) {
    const parts = srcFiles[0].split('/');
    if (parts.length >= 2) return parts[1]; // src/<scope>/
  }
  // fallback: first directory
  const first = files[0].split('/');
  if (first.length >= 2) return first[0];
  return '';
}

function inferCommitSuggestion(changedFiles, branch) {
  const fileList = (changedFiles || []).map(f => f.file || f);
  const fromBranch = inferTypeFromBranch(branch);
  const fromFiles = inferTypeFromFiles(fileList);
  const type = fromBranch || fromFiles || 'feat';
  const scope = inferScopeFromFiles(fileList);
  // Simple subject draft from file list
  let subject = '';
  if (fileList.length === 1) subject = `update ${path.basename(fileList[0])}`;
  else if (fileList.length) subject = `update ${fileList.length} files in ${scope || 'project'}`;
  else subject = 'update';
  return { type, scope, subject };
}

function aiDraftFallback(changedFiles, branch) {
  // Offline heuristic fallback for --ai when no provider configured
  const { type, scope, subject } = inferCommitSuggestion(changedFiles, branch);
  const fileList = (changedFiles || []).map(f=>f.file||f);
  let body = '';
  if (fileList.length) body = `Changed files:\n${fileList.slice(0,5).join('\n')}`;
  return { type, scope, subject, body };
}

module.exports = { inferTypeFromBranch, inferTypeFromFiles, inferScopeFromFiles, inferCommitSuggestion, aiDraftFallback };

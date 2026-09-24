const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const _gitMod = require('../utils/git');
const { isProtected } = require('../utils/constants');
const { UserError } = require('../utils/errors');
const { ensureGitRepo, runGit, getChangedFiles } = _gitMod;

const CONVENTIONAL_RE = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\(.+\))?: .+/;
const LARGE_BYTES = 1 * 1024 * 1024; // 1MB

function getDiff(cached) {
  const flag = cached ? '--cached' : '';
  // unified=0 keeps output small, still shows added lines
  const out = runGit(`diff ${flag} --unified=0`, { allowError: true, raw: true }) || '';
  return out;
}

function addedLines(diff) {
  return diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
}

const review = new Command('review')
  .description('Pre-push quality gate — secrets, WIP, conventional, large blobs, whitespace, conflict markers')
  .option('--staged', 'only check staged changes')
  .option('--all', 'check staged + unstaged + untracked (default: staged if any, else worktree)')
  .option('--strict', 'exit 1 on warnings (for CI / pre-push)')
  .option('--json', 'machine-readable JSON output')
  .option('--dry-run', 'preview without non-zero exit')
  .option('--fix', 'show auto-fix hints (non-destructive)')
  .action((opts) => {
    ensureGitRepo();

    const changed = getChangedFiles();
    const hasStaged = changed.some(f => f.staged);
    let scopeFiles;
    if (opts.staged) scopeFiles = changed.filter(f => f.staged);
    else if (opts.all) scopeFiles = changed;
    else scopeFiles = hasStaged ? changed.filter(f => f.staged) : changed;

    const useCached = hasStaged && !opts.all;
    const diff = getDiff(useCached);
    const added = addedLines(diff).join('\n');

    const issues = [];

    // 1) secrets / protected files
    for (const f of scopeFiles) {
      if (isProtected(f.file)) {
        issues.push({ severity: 'error', rule: 'protected', file: f.file, message: `protected file staged: ${f.file} → sg untrack ${f.file} or --force` });
      }
    }

    // 2) large blobs
    for (const f of scopeFiles) {
      try {
        const full = path.join(process.cwd(), f.file);
        if (fs.existsSync(full)) {
          const stat = fs.statSync(full);
          if (stat.isFile() && stat.size > LARGE_BYTES) {
            const mb = (stat.size / 1024 / 1024).toFixed(2);
            issues.push({ severity: 'error', rule: 'large-blob', file: f.file, message: `large file ${f.file} (${mb} MB > 1 MB) → add to .gitignore or use LFS` });
          }
        }
      } catch {}
    }

    // 3) conflict markers
    if (added.includes('<<<<<<<') || added.includes('>>>>>>>') || diff.includes('<<<<<<<')) {
      issues.push({ severity: 'error', rule: 'conflict-marker', message: 'conflict markers (<<<<<<<) found in diff → resolve before push' });
    }

    // 4) WIP / TODO / console.log / debugger
    const wipRe = /\b(WIP|TODO|FIXME|HACK|console\.log|debugger)\b/i;
    const wipHits = added.split('\n').filter(l => wipRe.test(l));
    if (wipHits.length) {
      const sample = wipHits.slice(0, 3).join('; ').slice(0, 120);
      issues.push({ severity: 'warn', rule: 'wip', message: `WIP/TODO/console.log found (${wipHits.length} hit(s)): ${sample}` });
    }

    // 5) whitespace errors
    const ws = runGit(`diff --check ${useCached ? '--cached' : ''}`, { allowError: true, raw: true });
    if (ws && ws.trim()) {
      const lines = ws.trim().split('\n').slice(0, 5).join('\n');
      issues.push({ severity: 'warn', rule: 'whitespace', message: `whitespace errors:\n${lines}` });
    }

    // 6) conventional commit lint (last commit)
    const lastMsg = runGit('log -1 --pretty=%s', { allowError: true }) || '';
    if (lastMsg && !CONVENTIONAL_RE.test(lastMsg)) {
      issues.push({ severity: 'warn', rule: 'conventional', message: `last commit not conventional: "${lastMsg}" → feat/fix/docs: subject` });
    }

    // 7) no changes?
    if (!scopeFiles.length && !diff.trim()) {
      // still report conventional even if clean
      if (opts.json) {
        console.log(JSON.stringify({ issues, summary: { errors: 0, warns: 0, files: 0, status: 'clean' } }, null, 2));
        return;
      }
      console.log(chalk.bold.cyan('▸ smart review'));
      console.log(chalk.gray('─'.repeat(40)));
      if (issues.length === 0) {
        console.log(chalk.green('✔ Nothing to review — working tree clean'));
        if (lastMsg) console.log(chalk.gray(`  last: ${lastMsg}`));
      } else {
        // show conventional warning even on clean
        issues.forEach(i => {
          const col = i.severity === 'error' ? chalk.red : chalk.yellow;
          console.log(col(`  ${i.severity === 'error' ? '✖' : '⚠'} [${i.rule}] ${i.message}`));
        });
      }
      console.log(chalk.gray('─'.repeat(40)));
      return;
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warns = issues.filter(i => i.severity === 'warn').length;

    if (opts.json) {
      console.log(JSON.stringify({ issues, summary: { errors, warns, files: scopeFiles.length, status: errors ? 'fail' : warns ? 'warn' : 'pass' } }, null, 2));
      if (!opts.dryRun && (errors || (opts.strict && warns))) process.exitCode = 1;
      return;
    }

    console.log(chalk.bold.cyan('▸ smart review') + chalk.gray(` — ${scopeFiles.length} file(s) ${useCached ? '(staged)' : '(worktree)'}`));
    console.log(chalk.gray('─'.repeat(40)));
    if (!issues.length) {
      console.log(chalk.green('✔ Pass — no issues found'));
      if (scopeFiles.length) console.log(chalk.gray(`  checked: ${scopeFiles.map(f=>f.file).slice(0,5).join(', ')}${scopeFiles.length>5?` +${scopeFiles.length-5} more`:''}`));
    } else {
      for (const i of issues) {
        const col = i.severity === 'error' ? chalk.red : chalk.yellow;
        const icon = i.severity === 'error' ? '✖' : '⚠';
        const file = i.file ? chalk.gray(` (${i.file})`) : '';
        // split multiline messages
        const msg = i.message.split('\n').map((l,idx)=> idx===0 ? l : '    '+l).join('\n');
        console.log(col(`  ${icon} [${i.rule}] ${msg}${file}`));
      }
      console.log(chalk.gray('─'.repeat(40)));
      if (errors) console.log(chalk.red(`✖ ${errors} error(s)` + (warns? chalk.yellow(`, ${warns} warning(s)`):'')));
      else console.log(chalk.yellow(`⚠ ${warns} warning(s)`));
      if (opts.fix) {
        console.log(chalk.gray('Hints:'));
        if (issues.some(i=>i.rule==='protected')) console.log(chalk.gray('  • sg untrack <file>  • sg ignore "<pattern>"  • move secrets to .env'));
        if (issues.some(i=>i.rule==='large-blob')) console.log(chalk.gray('  • git rm --cached <file> && echo "<file>" >> .gitignore'));
        if (issues.some(i=>i.rule==='wip')) console.log(chalk.gray('  • remove TODO/console.log before push'));
        if (issues.some(i=>i.rule==='whitespace')) console.log(chalk.gray('  • git diff --check -- then fix trailing whitespace'));
        if (issues.some(i=>i.rule==='conventional')) console.log(chalk.gray('  • sg commit --amend -m "feat(scope): subject"'));
      } else if (errors || warns) {
        console.log(chalk.gray('  re-run with --fix for hints, --strict to fail on warnings, --json for CI'));
      }
    }
    console.log(chalk.gray('─'.repeat(40)));
    if (!opts.dryRun && (errors || (opts.strict && warns))) {
      throw new UserError(`${errors ? errors+' error(s)' : warns+' warning(s)'} — review ${errors?'failed':'strict failed'}`);
    }
  });

module.exports = review;

const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');

const diff = new Command('diff')
  .description('Smart diff — summary + staged/unstaged split with stats, or ref-to-ref diff (improves `git diff`)')
  .argument('[refs...]', 'diff refs — e.g. `sg diff main HEAD` or `sg diff HEAD~1` (vs working tree)')
  .option('--staged', 'show staged only')
  .option('--stat', 'show stat only')
  .option('--check', 'summary only, no patch')
  .option('--patch', 'show full diff patch (default: stats + summary only)')
  .action((...args) => {
    let refs = [];
    let opts = {};
    for (const a of args) {
      if (Array.isArray(a)) refs = a;
      else if (a && typeof a === 'object') {
        opts = typeof a.opts === 'function' ? a.opts() : a;
      }
    }
    ensureGitRepo();
    console.log(chalk.bold.cyan('▸ smart diff'));
    console.log(chalk.gray('─'.repeat(40)));

    if (refs.length) {
      const diffRefs = refs.slice(0, 2);
      const base = ['diff'];
      // git rejects --cached with two revisions; a ref-vs-ref diff never involves
      // the index, so drop it and say so (audit pass 2 finding 5).
      if (opts.staged && diffRefs.length < 2) base.push('--cached');
      else if (opts.staged) console.log(chalk.gray('  (--staged ignored — comparing commits, index not involved)'));
      base.push(...diffRefs);
      const stat = runGit([...base, '--stat'].join(' '), { allowError: true }) || '(no diff)';
      console.log(chalk.bold(`Diff ${diffRefs.join(' ')}` + (opts.staged ? ' (staged)' : '') + ':'));
      console.log(chalk.yellow(stat));
      console.log(chalk.gray('─'.repeat(40)));
      if (opts.check || opts.stat || !opts.patch) return;
      const rawPatch = runGit([...base, '--color=always'].join(' '), { allowError: true });
      if (rawPatch && rawPatch.trim()) {
        const lines = rawPatch.split('\n');
        console.log(lines.slice(0, 200).join('\n'));
        if (lines.length > 200) console.log(chalk.gray(`... truncated (${lines.length} lines), use \`git diff\` for full patch`));
      }
      return;
    }

    const stagedStat = runGit('diff --cached --stat', { allowError: true }) || '(no staged)';
    const unstagedStat = runGit('diff --stat', { allowError: true }) || '(no unstaged)';
    const untracked = runGit('ls-files --others --exclude-standard', { allowError: true }) || '';

    if (opts.staged && !opts.patch) {
      // --staged (no --patch): show staged stats only, then stop — matches docs.
      console.log(chalk.bold('Staged:'));
      console.log(chalk.yellow(stagedStat));
      return;
    }

    console.log(chalk.bold('Staged:'));
    console.log(chalk.yellow(stagedStat));
    console.log(chalk.bold('Unstaged:'));
    console.log(chalk.red(unstagedStat));
    if (untracked) {
      console.log(chalk.bold('Untracked:'));
      console.log(chalk.gray(untracked.split('\n').map(f=>`  ? ${f}`).join('\n')));
    }

    if (opts.check || opts.stat) return;

    // Default = stats + summary only (avoids the wall-of-text git diff gives you).
    if (!opts.patch) return;

    const target = opts.staged ? '--cached' : '';
    const rawPatch = runGit(`diff ${target} --color=always`, { allowError: true });
    if (rawPatch && rawPatch.trim()) {
      const lines = rawPatch.split('\n');
      const patch = lines.slice(0, 200).join('\n');
      console.log(chalk.gray('─'.repeat(40)));
      console.log(patch);
      if (lines.length > 200) console.log(chalk.gray('... truncated (200/ ' + lines.length + ' lines), use `git diff` for full patch'));
    }
  });

module.exports = diff;

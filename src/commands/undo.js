const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getChangedFiles, unstageFiles, discardFiles } = require('../utils/git');

function getCommitCount() {
  try {
    const c = runGit('rev-list --count HEAD', { allowError: true });
    return parseInt(c || '0', 10);
  } catch { return 0; }
}

function isSingleCommit() {
  return getCommitCount() <= 1;
}

async function undoFiles(files, opts) {
  const changed = new Map(getChangedFiles().map(f => [f.file, f]));
  for (const file of files) {
    const f = changed.get(file);
    if (!f) {
      console.log(chalk.yellow(`✖ "${file}" has no changes to undo`));
      continue;
    }
    const isUntracked = f.xy === '??';
    const stagedOnly = f.staged && !f.unstaged;
    const unstagedOnly = !isUntracked && f.unstaged && !f.staged;

    if (isUntracked) {
      if (!opts.yes) {
        const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Delete untracked file "${file}"? (irreversible)`), default: false }]);
        if (!ok) { console.log(chalk.yellow('  skipped')); continue; }
      }
      console.log(chalk.gray(`→ git clean -f -- ${file}`));
      discardFiles([file]);
      console.log(chalk.green(`✔ Deleted untracked ${file}`));
    } else if (stagedOnly) {
      // unstage is reversible — no confirm needed
      console.log(chalk.gray(`→ git restore --staged -- ${file}`));
      unstageFiles([file]);
      console.log(chalk.green(`✔ Unstaged ${file} (changes kept)`));
    } else if (unstagedOnly) {
      if (!opts.yes) {
        const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Discard changes to "${file}"? (irreversible)`), default: false }]);
        if (!ok) { console.log(chalk.yellow('  skipped')); continue; }
      }
      console.log(chalk.gray(`→ git restore -- ${file}`));
      discardFiles([file]);
      console.log(chalk.green(`✔ Discarded changes to ${file}`));
    } else {
      // both staged and unstaged (e.g. MM) — let the user choose
      const { mode } = await inquirer.prompt([{
        type: 'list',
        name: 'mode',
        message: `"${file}" is staged AND modified. What to do?`,
        choices: [
          { name: 'unstage only (keep working changes)', value: 'unstage' },
          { name: 'discard all changes (irreversible)', value: 'discard' },
          { name: 'cancel', value: 'cancel' },
        ],
      }]);
      if (mode === 'cancel') { console.log(chalk.yellow('  skipped')); continue; }
      if (mode === 'unstage') {
        unstageFiles([file]);
        console.log(chalk.green(`✔ Unstaged ${file}`));
        continue;
      }
      if (!opts.yes) {
        const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Discard ALL changes to "${file}"? (irreversible)`), default: false }]);
        if (!ok) { console.log(chalk.yellow('  skipped')); continue; }
      }
      // includeStaged: restore index AND worktree, or the staged version silently
      // survives and the next commit still includes it (audit pass 2 finding 2).
      discardFiles([file], { includeStaged: true });
      console.log(chalk.green(`✔ Discarded all changes to ${file}`));
    }
  }
}

const undo = new Command('undo')
  .description('Safe undo — revert last commit, discard changes with confirm (improves `git reset`/`revert`)')
  .argument('[files...]', 'files to unstage or discard (e.g. sg undo src/foo.js)')
  .option('--soft', 'soft reset (keep staged)')
  .option('--hard', 'hard reset (discard all) — requires confirm')
  .option('--commit <hash>', 'undo specific commit via revert')
  .option('--yes', 'skip discard confirmation (sg undo <file>)')
  .action(async (...args) => {
    let files = [];
    let opts = {};
    for (const a of args) {
      if (Array.isArray(a)) files = a;
      else if (a && typeof a === 'object') {
        opts = typeof a.opts === 'function' ? a.opts() : a;
      }
    }
    ensureGitRepo();

    if (files.length) {
      await undoFiles(files, opts);
      return;
    }

    if (opts.commit) {
      console.log(chalk.gray(`→ git revert ${opts.commit}`));
      try { runGit(`revert ${opts.commit}`); console.log(chalk.green('✔ Reverted')); } catch(e){ console.error(chalk.red(e.message));}
      return;
    }

    // Show last commit
    const last = runGit('log -1 --oneline', { allowError: true }) || '(no commits)';
    const status = runGit('status --porcelain', { allowError: true }) || '';
    console.log(chalk.bold.cyan('▸ smart undo'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`${chalk.bold('Last commit:')} ${chalk.yellow(last)}`);
    if (status) console.log(`${chalk.bold('Working tree:')} ${chalk.red('dirty')} (${status.split('\n').filter(Boolean).length} file(s) changed)`);
    else console.log(`${chalk.bold('Working tree:')} ${chalk.green('clean')}`);

    const single = isSingleCommit();

    if (opts.hard) {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Hard reset will discard ALL local changes. Are you sure?'), default: false }]);
      if (!ok) { console.log(chalk.yellow('Aborted.')); return; }
      if (single) {
        runGit('update-ref -d HEAD', { allowError: true });
        runGit('reset --hard', { allowError: true });
        try { runGit('clean -fd', { allowError: true }); } catch {}
        console.log(chalk.green('✔ Hard undone: initial commit removed, working tree reset'));
      } else {
        runGit('reset --hard HEAD~1');
        console.log(chalk.green('✔ Hard undone: last commit discarded, working tree reset'));
      }
      return;
    }

    if (opts.soft) {
      if (single) {
        runGit('update-ref -d HEAD', { allowError: true });
        console.log(chalk.green('✔ Soft undone: initial commit undone, changes remain staged'));
        console.log(chalk.gray('→ use `sg commit` to recommit or `sg status` to review'));
      } else {
        runGit('reset --soft HEAD~1');
        console.log(chalk.green('✔ Soft undone: last commit undone, changes remain staged'));
        console.log(chalk.gray('→ use `sg commit` to recommit or `sg status` to review'));
      }
      return;
    }

    // Interactive
    const { mode } = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: 'How to undo?',
      choices: [
        { name: 'soft  — undo commit, keep staged (safe)', value: 'soft' },
        { name: 'mixed — undo commit, keep unstaged (default git)', value: 'mixed' },
        { name: 'hard  — discard commit + all changes (danger)', value: 'hard' },
        { name: 'revert — create new commit that reverts last (safe for pushed)', value: 'revert' },
        { name: 'cancel', value: 'cancel' },
      ]
    }]);

    if (mode === 'cancel') return;

    if (mode === 'revert') {
      try {
        runGit('revert HEAD --no-edit');
        console.log(chalk.green('✔ Reverted HEAD with new commit'));
      } catch(e) {
        console.error(chalk.red('Revert failed:'), e.message);
      }
      return;
    }

    if (mode === 'hard') {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Confirm hard reset?'), default: false }]);
      if (!ok) return;
    }

    if (single) {
      if (mode === 'soft') {
        runGit('update-ref -d HEAD', { allowError: true });
        console.log(chalk.green(`✔ Undone initial commit with --soft (staged)`));
      } else if (mode === 'mixed') {
        runGit('update-ref -d HEAD', { allowError: true });
        runGit('reset', { allowError: true });
        console.log(chalk.green(`✔ Undone initial commit with --mixed (unstaged)`));
      } else {
        runGit('update-ref -d HEAD', { allowError: true });
        runGit('reset --hard', { allowError: true });
        try { runGit('clean -fd', { allowError: true }); } catch {}
        console.log(chalk.green(`✔ Undone initial commit with --hard`));
      }
      return;
    }

    const cmd = mode === 'soft' ? 'reset --soft HEAD~1' : mode === 'mixed' ? 'reset HEAD~1' : 'reset --hard HEAD~1';
    try {
      runGit(cmd);
      console.log(chalk.green(`✔ Undone with --${mode}`));
    } catch(e) {
      console.error(chalk.red('Undo failed:'), e.message);
    }
  });

module.exports = undo;

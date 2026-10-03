const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const _gitMod = require('../utils/git');
const { undoFiles, restoreFromSource, isSingleCommit } = require('./undo/handlers');
const { ensureGitRepo, runGit, restoreFiles } = _gitMod;

const undo = new Command('undo')
  .description('Safe undo — revert last commit, unstage or discard files with confirm (a `git restore` superset)')
  .argument('[files...]', 'files or pathspecs to unstage/discard (".", "src/", "*.js") — e.g. sg undo . restores everything')
  .option('--soft', 'soft reset (keep staged)')
  .option('--hard', 'hard reset (discard all) — requires confirm')
  .option('--commit <hash>', 'undo specific commit via revert')
  .option('--source <ref>', 'restore selected paths from a revision (git restore --source <ref>)')
  .option('--staged', 'only touch the index — unstage files (git restore --staged)')
  .option('--worktree', 'only touch the worktree (combine with --staged for both)')
  .option('--patch', 'pick hunks interactively (git restore -p)')
  .option('--yes', 'skip discard confirmation (sg undo <file>)')
  .option('--verbose', 'show git commands (quiet by default)')
  .action(async (...args) => {
    let files = [];
    let opts = {};
    for (const a of args) {
      if (Array.isArray(a)) files = a;
      else if (a && typeof a === 'object') opts = typeof a.opts === 'function' ? a.opts() : a;
    }
    ensureGitRepo();

    if (opts.patch) {
      console.log(chalk.gray(files.length ? `→ git restore -p${opts.source ? ` --source=${opts.source}` : ''} -- ${files.join(' ')}` : `→ git restore -p${opts.source ? ` --source=${opts.source}` : ''} (all changed files)`));
      restoreFiles(files, { patch: true, source: opts.source, interactive: true });
      console.log(chalk.green('✔ Patch restore finished (git asked per hunk)'));
      return;
    }
    if (opts.source) { await restoreFromSource(files, opts); return; }
    if (files.length) { await undoFiles(files, opts); return; }
    if (opts.commit) {
      console.log(chalk.gray(`→ git revert ${opts.commit}`));
      try { runGit(['revert', opts.commit]); console.log(chalk.green('✔ Reverted')); } catch(e){ console.error(chalk.red(e.message));}
      return;
    }

    const last = runGit('log -1 --oneline', { allowError: true }) || '(no commits)';
    const status = runGit('status --porcelain', { allowError: true }) || '';
    console.log(chalk.bold.cyan('▸ smart undo'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`${chalk.bold('Last commit:')} ${chalk.yellow(last)}`);
    const dirtyCount = status.split('\n').filter(Boolean).length;
    if (status) console.log(`${chalk.bold('Working tree:')} ${chalk.red('dirty')} (${dirtyCount} file(s) changed) -- restore with ${chalk.cyan('sg undo .')} or ${chalk.cyan('sg undo <file>')}`);
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
      } else { runGit('reset --hard HEAD~1'); console.log(chalk.green('✔ Hard undone: last commit discarded, working tree reset')); }
      return;
    }
    if (opts.soft) {
      if (single) { runGit('update-ref -d HEAD', { allowError: true }); console.log(chalk.green('✔ Soft undone: initial commit undone, changes remain staged')); console.log(chalk.gray('→ use `sg commit` to recommit or `sg status` to review')); }
      else { runGit('reset --soft HEAD~1'); console.log(chalk.green('✔ Soft undone: last commit undone, changes remain staged')); console.log(chalk.gray('→ use `sg commit` to recommit or `sg status` to review')); }
      return;
    }

    const isDirty = Boolean(status.trim());
    const choices = [
        { name: 'soft  — undo commit, keep staged (safe)', value: 'soft' },
        { name: 'mixed — undo commit, keep unstaged (default git)', value: 'mixed' },
        { name: 'hard  — discard commit + all changes (danger)', value: 'hard' },
        { name: 'revert — create new commit that reverts last (safe for pushed)', value: 'revert' },
    ];
    if (isDirty) choices.splice(3, 0, { name: 'restore — discard working tree changes to HEAD (sg undo .)', value: 'restore' });
    choices.push({ name: 'cancel', value: 'cancel' });
    const { mode } = await inquirer.prompt([{ type: 'list', name: 'mode', message: 'How to undo?', choices }]);
    if (mode === 'cancel') return;
    if (mode === 'restore') {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Discard ${dirtyCount} file(s) in working tree to HEAD? (irreversible)`), default: false }]);
      if (!ok) { console.log(chalk.yellow('Cancelled.')); return; }
      await undoFiles(['.'], { yes: true });
      return;
    }
    if (mode === 'revert') {
      try { runGit('revert HEAD --no-edit'); console.log(chalk.green('✔ Reverted HEAD with new commit')); } catch(e) { console.error(chalk.red('Revert failed:'), e.message); }
      return;
    }
    if (mode === 'hard') {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Confirm hard reset?'), default: false }]);
      if (!ok) return;
    }
    if (single) {
      if (mode === 'soft') { runGit('update-ref -d HEAD', { allowError: true }); console.log(chalk.green(`✔ Undone initial commit with --soft (staged)`)); }
      else if (mode === 'mixed') { runGit('update-ref -d HEAD', { allowError: true }); runGit('reset', { allowError: true }); console.log(chalk.green(`✔ Undone initial commit with --mixed (unstaged)`)); }
      else { runGit('update-ref -d HEAD', { allowError: true }); runGit('reset --hard', { allowError: true }); try { runGit('clean -fd', { allowError: true }); } catch {} console.log(chalk.green(`✔ Undone initial commit with --hard`)); }
      return;
    }
    const cmd = mode === 'soft' ? 'reset --soft HEAD~1' : mode === 'mixed' ? 'reset HEAD~1' : 'reset --hard HEAD~1';
    try { runGit(cmd); console.log(chalk.green(`✔ Undone with --${mode}`)); } catch(e) { console.error(chalk.red('Undo failed:'), e.message); }
  });

module.exports = undo;

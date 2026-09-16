const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getCurrentBranch, getAheadBehind, getStatusPorcelain } = require('../utils/git');

const sync = new Command('sync')
  .description('Smart sync — stash, pull --rebase, push with upstream setup (improves `git pull`/`push`)')
  .option('--no-rebase', 'use merge instead of rebase')
  .option('--no-push', 'do not push after pull')
  .option('--force', 'force push with lease')
  .option('--dry-run', 'show steps without executing')
  .action(async (opts) => {
    ensureGitRepo();
    const branch = getCurrentBranch();
    const { hasUpstream } = getAheadBehind();
    const dirty = !!getStatusPorcelain().trim();

    console.log(chalk.bold.cyan(`▸ smart sync — branch ${chalk.green(branch)}`));
    console.log(chalk.gray('─'.repeat(40)));

    const steps = [];
    let stashed = false;

    if (dirty) {
      steps.push('stash push -m "smart-git auto-stash before sync"');
    }
    steps.push('fetch --prune');
    if (hasUpstream) {
      steps.push(opts.rebase === false ? 'pull' : 'pull --rebase --autostash');
    } else {
      steps.push(`push -u origin ${branch} (set upstream)`);
    }
    if (opts.push !== false && hasUpstream) steps.push('push');

    if (opts.dryRun) {
      console.log(chalk.yellow('[dry-run] Would execute:'));
      steps.forEach(s => console.log(chalk.gray('  • ') + s));
      return;
    }

    try {
      if (dirty) {
        console.log(chalk.gray('→ stashing local changes...'));
        runGit('stash push -m "smart-git auto-stash before sync"');
        stashed = true;
      }

      console.log(chalk.gray('→ git fetch --prune'));
      const fetched = runGit('fetch --prune', { allowError: true });
      if (fetched === null) {
        console.log(chalk.yellow('  (no remote or fetch failed — continuing)'));
      }

      if (!hasUpstream) {
        console.log(chalk.yellow(`No upstream for ${branch}. Setting upstream...`));
        // Check remote exists
        const remotes = runGit('remote', { allowError: true }) || '';
        if (!remotes.includes('origin')) {
          console.error(chalk.red('No remote "origin" configured. Add one: git remote add origin <url>'));
          if (stashed) runGit('stash pop', { allowError: true });
          return;
        }
        console.log(chalk.gray(`→ git push -u origin ${branch}`));
        runGit(`push -u origin ${branch}`);
        console.log(chalk.green('✔ Sync complete (upstream set)'));
      } else {
        const pullCmd = opts.rebase === false ? 'pull' : 'pull --rebase --autostash';
        console.log(chalk.gray(`→ git ${pullCmd}`));
        try {
          runGit(pullCmd);
          console.log(chalk.green('✔ Pulled successfully'));
        } catch (e) {
          console.error(chalk.red('✖ Pull failed (conflict?)'));
          console.error(chalk.gray(e.message));
          console.log(chalk.yellow('Resolve conflicts then run: ') + chalk.cyan('git rebase --continue') + ' or ' + chalk.cyan('sg undo'));
          if (stashed) console.log(chalk.gray('Your local changes are stashed. Restore with: git stash pop'));
          return;
        }

        if (opts.push !== false) {
          const ahead = (() => { try { return parseInt(runGit('rev-list --count @{u}..HEAD', { allowError: true })||'0',10);} catch {return 0;}})();
          if (ahead > 0) {
            const pushCmd = opts.force ? 'push --force-with-lease' : 'push';
            console.log(chalk.gray(`→ git ${pushCmd} (${ahead} commit(s) ahead)`));
            runGit(pushCmd);
            console.log(chalk.green('✔ Pushed'));
          } else {
            console.log(chalk.gray('Already up to date on remote'));
          }
        }
      }

      if (stashed) {
        // Check if already popped via autostash
        const stillStashed = runGit('stash list', { allowError: true }) || '';
        if (stillStashed.includes('smart-git auto-stash')) {
          console.log(chalk.gray('→ restoring stash...'));
          runGit('stash pop', { allowError: true });
        }
      }

      console.log(chalk.green.bold('✔ Sync complete'));
    } catch (e) {
      console.error(chalk.red('✖ Sync failed:'), e.message);
      if (stashed) console.log(chalk.yellow('Restore stashed changes with: git stash pop'));
    }
  });

module.exports = sync;

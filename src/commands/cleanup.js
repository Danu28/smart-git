const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getCurrentBranch } = require('../utils/git');

const cleanup = new Command('cleanup')
  .description('Cleanup — delete merged branches, prune remotes, gc (improves `git branch -d` + `git gc`)')
  .option('--dry-run', 'show what would be deleted')
  .option('--yes', 'skip confirmation')
  .action(async (opts) => {
    ensureGitRepo();
    console.log(chalk.bold.cyan('▸ smart cleanup'));
    console.log(chalk.gray('─'.repeat(40)));

    const current = getCurrentBranch();
    const mergedRaw = runGit('branch --merged', { allowError: true }) || '';
    const candidates = mergedRaw.split('\n').map(b => b.replace('*','').trim()).filter(b => b && b !== current && !['main','master','develop','dev'].includes(b));

    const remotePrune = runGit('remote prune origin --dry-run', { allowError: true }) || '';

    if (!candidates.length && !remotePrune.trim()) {
      console.log(chalk.green('✔ Nothing to clean. Already tidy!'));
      return;
    }

    if (candidates.length) {
      console.log(chalk.bold(`Merged branches (${candidates.length}):`));
      candidates.forEach(b => console.log(chalk.gray('  • ') + b));
    }
    if (remotePrune.trim()) {
      console.log(chalk.bold('Prunable remotes:'));
      console.log(chalk.gray(remotePrune));
    }

    if (opts.dryRun) {
      console.log(chalk.yellow('[dry-run] No changes made'));
      return;
    }

    if (!opts.yes && candidates.length) {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: `Delete ${candidates.length} merged branch(es)?`, default: false }]);
      if (!ok) { console.log(chalk.yellow('Skipped branch deletion')); }
      else {
        for (const b of candidates) {
          try { runGit(['branch', '-d', b]); console.log(chalk.green(`  deleted ${b}`)); } catch(e){ console.log(chalk.yellow(`  skip ${b}: ${e.message.slice(0,60)}`));}
        }
      }
    } else if (opts.yes) {
      for (const b of candidates) { try { runGit(['branch', '-d', b]); console.log(chalk.green(`  deleted ${b}`)); } catch{} }
    }

    // fetch only when actually cleaning — a dry-run must not touch the
    // network or mutate remote-tracking refs (audit pass 2 gap).
    console.log(chalk.gray('→ git fetch --prune'));
    runGit('fetch --prune', { allowError: true });

    console.log(chalk.gray('→ git remote prune origin'));
    runGit('remote prune origin', { allowError: true });
    console.log(chalk.gray('→ git gc suggestion: run `git gc` to optimize repo'));
    console.log(chalk.green.bold('✔ Cleanup complete'));
  });

module.exports = cleanup;

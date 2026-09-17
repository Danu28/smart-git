const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit, getCurrentBranch, getAheadBehind, getStatusPorcelain } = require('../utils/git');

const switc = new Command('switch')
  .description('Smart switch — jump between branches with sync info (improves `git switch`/`checkout`)')
  .argument('[branch]', 'branch to switch to (use "-" for the previous branch)')
  .action((branch) => {
    ensureGitRepo();
    const current = getCurrentBranch();

    if (!branch) {
      console.log(chalk.yellow(`Currently on ${chalk.bold(current)}. Use ${chalk.cyan('sg switch <branch>')} to jump, ${chalk.cyan('sg branch')} to list.`));
      return;
    }
    if (branch === current) {
      console.log(chalk.gray(`Already on ${chalk.green(current)}`));
      return;
    }

    if (branch !== '-') {
      // only switch to branches that actually exist — guide instead of failing cryptically
      // (show-ref --verify --quiet succeeds with EMPTY output, so check for null, not falsy)
      const exists = runGit(`show-ref --verify --quiet refs/heads/${branch}`, { allowError: true });
      if (exists === null) {
        console.error(chalk.red(`✖ Branch "${branch}" not found.`));
        console.error(chalk.gray(`  List:   ${chalk.cyan('sg branch')}`));
        console.error(chalk.gray(`  Create: ${chalk.cyan(`sg branch --create ${branch}`)}`));
        process.exit(1);
      }
    }

    try {
      runGit(`checkout ${branch}`);
    } catch (e) {
      console.error(chalk.red(`✖ Could not switch: ${e.message}`));
      console.log(chalk.yellow('  Local changes may block the switch — commit, stash (sg stash), or discard (sg undo <file>).'));
      process.exit(1);
    }

    const now = getCurrentBranch();
    const dirtyLines = (getStatusPorcelain() || '').split('\n').filter(Boolean).length;
    const { ahead, behind, hasUpstream } = getAheadBehind();
    console.log(chalk.green(`✔ Switched: ${chalk.bold(current)} → ${chalk.bold(now)}`));
    if (hasUpstream) {
      if (behind > 0) console.log(chalk.magenta(`  ↓${behind} behind remote`));
      if (ahead > 0) console.log(chalk.yellow(`  ↑${ahead} ahead of remote`));
      if (!ahead && !behind) console.log(chalk.gray('  up to date'));
    } else {
      console.log(chalk.gray('  no upstream — `sg sync` will set it'));
    }
    if (dirtyLines) console.log(chalk.yellow(`  working tree: ${dirtyLines} change(s) — sg status`));
  });

module.exports = switc;
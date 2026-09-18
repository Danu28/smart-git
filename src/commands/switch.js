const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit, getCurrentBranch, getAheadBehind, getStatusPorcelain } = require('../utils/git');
const { UserError } = require('../utils/errors');

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
      const exists = runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowError: true });
      if (exists === null) {
        throw new UserError(`Branch "${branch}" not found. List: sg branch / Create: sg branch --create ${branch}`);
      }
    }

    try {
      runGit(['checkout', branch]);
    } catch (e) {
      throw new UserError(`Could not switch: ${e.message}. Local changes may block the switch — commit, stash (sg stash), or discard (sg undo <file>).`);
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

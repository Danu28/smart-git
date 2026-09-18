const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit } = require('../utils/git');
const { getOperationState } = require('../utils/git-state');
const { UserError } = require('../utils/errors');

const fixup = new Command('fixup')
  .description('Create a fixup commit and autosquash it into history (improves `git commit --fixup` + `git rebase -i --autosquash`)')
  .argument('<commit>', 'commit to fix up (must be on the current branch history)')
  .option('--no-rebase', 'only create the fixup commit, skip the autosquash rebase')
  .option('--yes', 'skip the autosquash confirmation')
  .option('--dry-run', 'show what would run without executing')
  .action(async (commitish, opts) => {
    ensureGitRepo();

    const op = getOperationState();
    if (op.operation) {
      throw new UserError(`Cannot fixup while a ${op.operation} is in progress — resolve and sg continue or sg abort first.`);
    }

    const sha = runGit(['rev-parse', '--verify', `${commitish}^{commit}`], { allowError: true });
    if (!sha) {
      throw new UserError(`Not a commit: ${commitish}`);
    }
    const short = sha.slice(0, 7);
    const isAncestor = runGit(['merge-base', '--is-ancestor', sha, 'HEAD'], { allowError: true }) !== null;
    if (!isAncestor) {
      throw new UserError(`${short} is not in the current branch history — fixup must target a commit on this branch (or run it from that branch).`);
    }

    // mirror commit -m staging: prefer existing staged, else auto-stage all with a hint
    const staged = runGit('diff --cached --stat', { allowError: true });
    if (!staged) {
      console.log(chalk.yellow('Nothing staged — auto-staging all changes (use `git add <file>` first to control staging).'));
      if (!opts.dryRun) runGit('add -A');
    }

    if (opts.dryRun) {
      console.log(chalk.bold.cyan('▸ smart fixup'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.gray('  • git commit --fixup=') + chalk.cyan(short));
      console.log(chalk.gray('  • git rebase -i --autosquash --autostash') + (opts.rebase === false ? chalk.gray('  (skipped: --no-rebase)') : ''));
      console.log(chalk.yellow('[dry-run] No changes made'));
      return;
    }

    runGit(['commit', `--fixup=${short}`]);
    console.log(chalk.green(`✔ Created fixup commit for ${short}.`));

    if (opts.rebase === false) {
      console.log(chalk.gray('Next: ') + chalk.cyan('sg fixup --yes') + chalk.gray(' to autosquash, or `git rebase -i --autosquash`.'));
      return;
    }

    if (!opts.yes) {
      const { ok } = await inquirer.prompt([{
        type: 'confirm',
        name: 'ok',
        message: chalk.yellow(`Autosquash now? (git rebase -i --autosquash — rewrites history)`),
        default: true,
      }]);
      if (!ok) {
        console.log(chalk.yellow('Fixup committed, rebase skipped — run ') + chalk.cyan('sg fixup --yes') + chalk.yellow(' when ready.'));
        return;
      }
    }

    // Autosquash rebase: bare `git rebase -i --autosquash` targets the branch's
    // upstream, which may not exist locally. Rebase onto the fixup target's
    // parent explicitly (--root when the target is the initial commit).
    const onto = (runGit(['rev-parse', '--verify', `${sha}^`], { allowError: true }) || '').trim() || '--root';
    runGit(['rebase', '-i', '--autosquash', '--autostash', onto], { env: { GIT_SEQUENCE_EDITOR: 'true', GIT_EDITOR: 'true' } });
    console.log(chalk.green(`✔ Autosquash complete — fixup folded into ${short}.`));
  });

module.exports = fixup;
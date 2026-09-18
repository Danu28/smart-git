const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit, getStashList, getStatusPorcelain } = require('../utils/git');
const { getOperationState, getUnmergedPaths, getBranchState, isShallowClone, hasCommits, OP_CMDS } = require('../utils/git-state');

const doctor = new Command('doctor')
  .description('Diagnose repo health — in-progress ops, conflicts, upstream, stashes (improves `git status` + guesswork)')
  .option('--fix', 'auto-fix: install missing completions hint and hooks')
  .action((opts) => {
    const fix = opts && opts.fix;
    ensureGitRepo();
    const b = getBranchState();
    const op = getOperationState();
    const unmerged = getUnmergedPaths();
    const shallow = isShallowClone();
    const commits = hasCommits();
    const stashCount = (getStashList() || '').split('\n').filter(Boolean).length;
    const porcelain = getStatusPorcelain();
    const dirtyCount = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
    const last = commits ? (runGit('log -1 --oneline', { allowError: true }) || '') : '';

    console.log(chalk.bold.cyan('▸ smart doctor'));
    console.log(chalk.gray('─'.repeat(40)));

    // branch line
    if (b.detached) {
      console.log(`${chalk.bold('Checkout:')} ${chalk.yellow('detached HEAD')} at ${chalk.cyan(b.short || '?')}${last ? chalk.gray(` — ${last}`) : ''}`);
      console.log(chalk.gray('  → reattach: ') + chalk.cyan('sg switch <branch>'));
    } else {
      console.log(`${chalk.bold('Branch:')} ${chalk.green(b.head)}`);
      if (b.upstream) {
        if (b.gone) {
          console.log(`${chalk.bold('Upstream:')} ${chalk.red(b.upstream)} ${chalk.red('[gone — deleted on remote]')}`);
          console.log(chalk.gray('  → cleanup: ') + chalk.cyan('git branch --unset-upstream'));
        } else {
          const ab = [];
          if (b.behind) ab.push(chalk.magenta(`↓${b.behind} behind`));
          if (b.ahead) ab.push(chalk.yellow(`↑${b.ahead} ahead`));
          console.log(`${chalk.bold('Upstream:')} ${chalk.green(b.upstream)}${ab.length ? ' — ' + ab.join(' ') : chalk.gray(' — up to date')}`);
        }
      } else {
        console.log(`${chalk.bold('Upstream:')} ${chalk.yellow('none')} → ${chalk.cyan('sg sync')} sets it`);
      }
    }

    // operation
    if (op.operation) {
      const prog = op.step || op.total ? ` (${op.step}/${op.total})` : '';
      const conf = unmerged.length ? ` — ${unmerged.length} conflicted file(s): ${unmerged.join(', ')}` : '';
      console.log(`${chalk.bold('Operation:')} ${chalk.red('⚠ ' + op.operation.toUpperCase() + ' in progress' + prog + conf)}`);
      const nextCmd = OP_CMDS.continue[op.operation] || 'bisect good|bad';
      console.log(chalk.gray('  → next: ') + chalk.cyan(`git ${nextCmd}`));
    } else if (unmerged.length) {
      console.log(`${chalk.bold('Operation:')} ${chalk.red('⚠ unmerged path(s): ' + unmerged.join(', '))}`);
      console.log(chalk.gray('  → resolve, then ') + chalk.cyan('sg commit') + chalk.gray(' or ') + chalk.cyan('git add <file>'));
    } else {
      console.log(`${chalk.bold('Operation:')} ${chalk.green('none ✔')}`);
    }

    console.log(`${chalk.bold('Stashes:')} ${stashCount ? chalk.cyan(stashCount) : chalk.gray('0')}`);
    if (shallow) console.log(`${chalk.bold('Shallow:')} ${chalk.yellow('yes — partial clone')} → ${chalk.cyan('git fetch --unshallow')} for full history`);
    console.log(`${chalk.bold('Commits:')} ${commits ? chalk.white((runGit('rev-list --count HEAD', { allowError: true }) || '?') + (last ? `  (last: ${last})` : '')) : chalk.yellow('none yet — start with `sg commit`')}`);
    console.log(`${chalk.bold('Tree:')} ${dirtyCount ? chalk.red(`${dirtyCount} file(s) changed`) : chalk.green('clean')}`);

    if (fix) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.bold('Fix:'));
      // check completion
      try {
        const shell = process.env.SHELL || '';
        if (shell.includes('zsh')) console.log(chalk.gray('  → sg completion zsh > ~/.zsh/completions/_sg'));
        else if (shell.includes('fish')) console.log(chalk.gray('  → sg completion fish > ~/.config/fish/completions/sg.fish'));
        else console.log(chalk.gray('  → sg completion bash > /etc/bash_completion.d/sg  or  source <(sg completion bash)'));
      } catch {}
      console.log(chalk.gray('  → sg init --hooks  to install pre-commit/pre-push hooks'));
      console.log(chalk.green('✔ Fix hints printed (run the commands above)'));
    }
    console.log(chalk.gray('─'.repeat(40)));
    const issues = [];
    if (op.operation) issues.push(`${op.operation} in progress`);
    if (unmerged.length) issues.push(`${unmerged.length} conflicted file(s)`);
    if (b.detached) issues.push('detached HEAD');
    if (b.gone) issues.push('gone upstream');
    if (!commits) issues.push('no commits');
    if (shallow) issues.push('shallow clone');
    if (issues.length) {
      console.log(chalk.yellow(`⚠ Doctor found: ${issues.join(', ')}`));
    } else {
      console.log(chalk.green.bold('✔ Healthy — nothing unusual detected.'));
    }
  });

module.exports = doctor;
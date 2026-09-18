const { Command } = require('commander');
const chalk = require('chalk');
const { spawnSync } = require('node:child_process');
const { ensureGitRepo, runGit, getCurrentBranch, getAheadBehind } = require('../utils/git');
const { UserError } = require('../utils/errors');

function ghBin() {
  const raw = process.env.SMART_GIT_GH || 'gh';
  return raw.replace(/^"(.*)"$/, '$1');
}

function isGhCmdShim(bin) {
  return /\.cmd$/i.test(bin) || /\.bat$/i.test(bin);
}

function printDegrade(branch) {
  console.log(chalk.yellow('gh CLI not found — push done, PR not created.'));
  const url = (runGit('remote get-url origin', { allowError: true }) || '').trim();
  const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (match) {
    const [, owner, repo] = match;
    const headRef = runGit('symbolic-ref refs/remotes/origin/HEAD', { allowError: true });
    const base = headRef ? headRef.replace(/^refs\/remotes\/origin\//, '') : 'main';
    console.log('  ' + chalk.cyan(`https://github.com/${owner}/${repo}/compare/${base}...${branch}?expand=1`));
  } else {
    console.log(chalk.gray(`  Could not build a compare URL from remote: ${url || '(none)'}`));
  }
  console.log('  Install gh to get PRs from the CLI: ' + chalk.cyan('https://cli.github.com') + '.');
}

function spawnGh(args, opts = {}) {
  const bin = ghBin();
  const needsShell = isGhCmdShim(bin);
  return spawnSync(bin, args, { ...opts, shell: needsShell });
}

const pr = new Command('pr')
  .description('Push the current branch and open a pull request via gh; degrades to a compare URL without gh (improves `git push` + `gh pr create`)')
  .option('--draft', 'open as a draft PR')
  .option('--web', 'open the PR in the browser')
  .option('--dry-run', 'show the steps without pushing or creating')
  .action((opts) => {
    ensureGitRepo();
    const branch = getCurrentBranch();
    if (!branch || branch === 'unknown' || branch === 'HEAD') {
      throw new UserError('Detached HEAD — checkout or create a branch first: sg branch --create <name>');
    }
    const remotes = (runGit('remote', { allowError: true }) || '').trim();
    if (!remotes) {
      throw new UserError('No git remotes configured — cannot open a PR. Add one: git remote add origin <url>');
    }

    const { ahead, hasUpstream } = getAheadBehind();
    const needPush = !hasUpstream || ahead > 0;
    const ghOk = spawnGh(['--version'], { stdio: 'ignore' }).status === 0;

    if (opts.dryRun) {
      console.log(chalk.bold.cyan(`▸ smart pr — branch ${chalk.green(branch)}`));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.gray('  • ') + (needPush ? chalk.cyan(`git push${!hasUpstream ? ' -u' : ''} origin ${branch}`) : chalk.gray('branch already pushed')));
      console.log(chalk.gray('  • ') + (ghOk ? chalk.cyan(`gh pr create --fill${opts.draft ? ' --draft' : ''}${opts.web ? ' --web' : ''}`) : chalk.gray('gh CLI not found — open the compare URL instead')));
      console.log(chalk.yellow('[dry-run] No changes made'));
      return;
    }

    if (needPush) {
      console.log(chalk.gray(`→ git push${!hasUpstream ? ' -u' : ''} origin ${branch}`));
      const pushArgs = !hasUpstream ? ['push', '-u', 'origin', branch] : ['push', 'origin', branch];
      runGit(pushArgs);
      console.log(chalk.green('✔ Pushed.'));
    }

    if (!ghOk) {
      printDegrade(branch);
      return;
    }

    console.log(chalk.gray(`→ gh pr create --fill${opts.draft ? ' --draft' : ''}${opts.web ? ' --web' : ''}`));
    const args = ['pr', 'create', '--fill'];
    if (opts.draft) args.push('--draft');
    if (opts.web) args.push('--web');
    const res = spawnGh(args, { stdio: 'inherit', env: process.env });
    if (res.status !== 0) {
      throw new UserError('gh pr create failed.');
    }
  });

module.exports = pr;

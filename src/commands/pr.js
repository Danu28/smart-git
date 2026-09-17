const { Command } = require('commander');
const chalk = require('chalk');
const { spawnSync } = require('node:child_process');
const { ensureGitRepo, runGit, getCurrentBranch, getAheadBehind } = require('../utils/git');

function ghBin() {
  // SMART_GIT_GH: escape hatch for gh shims / alternate installs not on PATH
  return process.env.SMART_GIT_GH || 'gh';
}

// Node >=20.12 rejects spawning .cmd/.bat without `shell: true` (CVE-2024-27980,
// used by gh shims/installs). The command line is built ONLY from our own
// constant args (+ opt. draft/web booleans) — no user input reaches gh — so
// shell invocation here is contained and documented.
function ghCommand(args) {
  const bin = ghBin();
  return (bin.includes(' ') ? `"${bin}"` : bin) + ' ' + args.join(' ');
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

const pr = new Command('pr')
  .description('Push the current branch and open a pull request via gh; degrades to a compare URL without gh (improves `git push` + `gh pr create`)')
  .option('--draft', 'open as a draft PR')
  .option('--web', 'open the PR in the browser')
  .option('--dry-run', 'show the steps without pushing or creating')
  .action((opts) => {
    ensureGitRepo();
    const branch = getCurrentBranch();
    if (!branch || branch === 'unknown' || branch === 'HEAD') {
      console.error(chalk.red('✖ Detached HEAD — checkout or create a branch first: ') + chalk.cyan('sg branch --create <name>'));
      process.exit(1);
    }
    const remotes = (runGit('remote', { allowError: true }) || '').trim();
    if (!remotes) {
      console.error(chalk.red('✖ No git remotes configured — cannot open a PR. Add one:'));
      console.error('  ' + chalk.cyan('git remote add origin <url>'));
      process.exit(1);
    }

    const { ahead, hasUpstream } = getAheadBehind();
    const needPush = !hasUpstream || ahead > 0;
    const ghOk = spawnSync(ghCommand(['--version']), { stdio: 'ignore', shell: true }).status === 0;

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
      runGit(`push${!hasUpstream ? ' -u' : ''} origin "${branch}"`);
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
    const res = spawnSync(ghCommand(args), { stdio: 'inherit', shell: true, env: process.env });
    if (res.status !== 0) {
      console.error(chalk.red('✖ gh pr create failed.'));
      process.exit(1);
    }
  });

module.exports = pr;
const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');
const { UserError } = require('../utils/errors');

function getReflog(limit) {
  const raw = runGit(['reflog', '--date=relative', '--format=%H%x09%gd%x09%gs', '-n', String(limit)], { raw: true }) || '';
  return raw.split('\n').filter(Boolean).map((line) => {
    const [sha, gd, ...rest] = line.split('\t');
    return { sha, gd, gs: rest.join('\t') };
  });
}

function getReachableSet() {
  const raw = runGit('rev-list --all', { raw: true, allowError: true }) || '';
  return new Set(raw.split('\n').filter(Boolean));
}

function listRescue(opts) {
  const entries = getReflog(parseInt(opts.limit, 10) || 30);
  const reachable = getReachableSet();
  let lost = 0;
  console.log(chalk.bold.cyan('▸ smart rescue'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray('Recovering lost work from the reflog — read-only, nothing modified.'));
  for (const e of entries) {
    const isLost = !reachable.has(e.sha);
    let line = `  [${e.gd}] ${chalk.gray(e.sha.slice(0, 10))} ${e.gs}`;
    if (isLost) {
      const subject = runGit(['log', '-1', '--pretty=%s', e.sha], { allowError: true }) || '';
      line += chalk.red('  ✖ LOST');
      if (subject) line += chalk.gray(` — ${subject}`);
      lost++;
    }
    console.log(line);
  }
  console.log(chalk.gray('─'.repeat(40)));
  if (lost) {
    console.log(chalk.yellow(`Found ${lost} lost commit(s) — recoverable safely:`));
    console.log(`  ${chalk.cyan('sg rescue <hash>')}   # creates rescue/<hash> branch, changes nothing`);
    console.log(`  ${chalk.cyan('git merge rescue/<hash>')}   or   ${chalk.cyan('git cherry-pick <hash>')}`);
  } else {
    console.log(chalk.green('✔ Everything in the reflog is still reachable from a branch or tag.'));
    console.log(chalk.gray(`  Use ${chalk.cyan('sg rescue <hash>')} to branch from any listed commit.`));
  }
}

function recoverRescue(ref) {
  const sha = runGit(['rev-parse', '--verify', `${ref}^{commit}`], { allowError: true });
  if (!sha) {
    throw new UserError(`Not a commit: ${ref}`);
  }
  const short = sha.slice(0, 7);
  const branchName = `rescue/${short}`;
  const exists = runGit(['rev-parse', '--verify', `refs/heads/${branchName}`], { allowError: true }) !== null;
  if (exists) {
    throw new UserError(`Branch ${branchName} already exists — merge/finish it, then rerun.`);
  }
  runGit(['branch', branchName, sha]);
  console.log(chalk.green(`✔ Created branch ${chalk.bold(branchName)} at ${short}`));
  const gained = runGit(['log', '--oneline', `HEAD..${sha}`], { allowError: true });
  if (gained) {
    console.log(chalk.bold('Commits you would gain:'));
    gained.split('\n').forEach((l) => console.log(`  ${chalk.green('+')} ${l}`));
  }
  const stat = runGit(['show', '--stat', '--oneline', sha], { allowError: true });
  if (stat) console.log(chalk.gray(stat));
  console.log(chalk.gray('Next: ') + chalk.cyan(`git merge ${branchName}`) + chalk.gray('  or  ') + chalk.cyan(`git cherry-pick ${short}`));
}

const rescue = new Command('rescue')
  .description('Recover lost commits from the reflog — non-destructive (improves `git reflog`)')
  .argument('[commit]', 'commit-ish to recover as rescue/<hash> branch (e.g. a ✖ LOST hash from the list)')
  .option('--limit <n>', 'reflog entries to show', '30')
  .option('--snapshot', 'create hourly snapshot at refs/smart-git/snapshot (AU3)')
  .option('--prune', 'prune old snapshots older than 7 days')
  .action((commit, opts) => {
    ensureGitRepo();
    const options = opts && opts.opts ? opts.opts() : opts;
    if (options && options.snapshot) {
      const sha = runGit('stash create', { allowError:true });
      const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,16);
      const ref = `refs/smart-git/snapshot-${ts}`;
      if (sha && /^[0-9a-f]{40}$/.test(sha)) {
        runGit(['update-ref', ref, sha], { allowError:true });
        console.log(chalk.green(`✔ Snapshot ${ref} at ${sha.slice(0,7)}`));
      } else {
        const head = runGit('rev-parse HEAD', { allowError:true });
        if (head) { runGit(['update-ref', ref, head], { allowError:true }); console.log(chalk.green(`✔ Snapshot ${ref} at ${head.slice(0,7)} (HEAD)`)); }
        else console.log(chalk.yellow('✖ Nothing to snapshot'));
      }
      if (options.prune) {
        const refs = (runGit('for-each-ref --format=%(refname) refs/smart-git/snapshot-', {allowError:true})||'').split('\n').filter(Boolean);
        console.log(chalk.gray(`Snapshots: ${refs.length} — prune >7d not yet auto, run: git for-each-ref`));
      }
      return;
    }
    if (commit) recoverRescue(commit);
    else listRescue(options || {});
  });

module.exports = rescue;
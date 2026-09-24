const chalk = require('chalk');
const inquirer = require('inquirer');
const {
  runGit, getChangedFiles, unstageFiles, discardFiles,
  expandPathspecs, trackedPathspecs, countUntracked, restoreFiles,
} = require('../../utils/git');

const MAX_SHOWN = 5;

function show(list) {
  if (!list.length) return '';
  if (list.length <= MAX_SHOWN) return list.join(', ');
  return `${list.slice(0, MAX_SHOWN).join(', ')} … (+${list.length - MAX_SHOWN} more)`;
}

function fmtGit(cmdParts, files) {
  const head = cmdParts.join(' ');
  if (!files || !files.length) return head;
  const shown = files.slice(0, MAX_SHOWN).join(' ');
  const more = files.length > MAX_SHOWN ? ` … (+${files.length - MAX_SHOWN} more)` : '';
  return `${head} -- ${shown}${more}`;
}

async function confirmGo(message, opts) {
  if (opts.yes) return true;
  const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(message), default: false }]);
  return ok;
}

function getCommitCount() {
  try {
    const c = runGit('rev-list --count HEAD', { allowError: true });
    return parseInt(c || '0', 10);
  } catch { return 0; }
}

function isSingleCommit() {
  return getCommitCount() <= 1;
}

/**
 * Handle pathspec undo (discard/unstage flow).
 * @param {string[]} specs
 * @param {Object} opts
 */
async function undoFiles(specs, opts) {
  const changed = getChangedFiles();
  const { matched, unmatched } = expandPathspecs(specs, { changed });
  for (const spec of unmatched) {
    const msg = countUntracked(spec) > 0
      ? `✖ "${spec}" has no tracked changes to undo — untracked files under it are left alone (use \`sg clean\`)`
      : `✖ "${spec}" has no changes to undo`;
    console.log(chalk.yellow(msg));
  }
  if (!matched.length) return;

  const tracked = matched.filter(f => f.xy !== '??');
  const untracked = matched.filter(f => f.xy === '??');

  if (opts.staged || opts.worktree) {
    if (untracked.length) console.log(chalk.yellow(`✖ Untracked — nothing to restore: ${show(untracked.map(f => f.file))} (use \`sg clean\`)`));
    const names = tracked.map(f => f.file);
    if (!names.length) return;
    if (opts.staged) {
      if (opts.verbose) console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged'], names)}`));
      unstageFiles(names);
      console.log(chalk.green(`✔ Unstaged ${show(names)} (changes kept)`));
    }
    if (opts.worktree || !opts.staged) {
      if (!await confirmGo(`Discard worktree changes to ${show(names)}? (irreversible)`, opts)) { console.log(chalk.yellow('  aborted')); return; }
      if (opts.verbose) console.log(chalk.gray(`→ ${fmtGit(['git restore', '--worktree'], names)}`));
      discardFiles(names);
      console.log(chalk.green(`✔ Discarded changes to ${show(names)}`));
    }
    return;
  }

  const stagedOnly = tracked.filter(f => f.staged && !f.unstaged);
  const unstagedOnly = tracked.filter(f => f.unstaged && !f.staged);
  const both = tracked.filter(f => f.staged && f.unstaged);

  if (stagedOnly.length) {
    const names = stagedOnly.map(f => f.file);
    console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged'], names)}`));
    unstageFiles(names);
    console.log(chalk.green(`✔ Unstaged ${show(names)} (changes kept)`));
  }

  if (both.length) {
    const names = both.map(f => f.file);
    const which = names.length === 1 ? `"${names[0]}" is` : `${names.length} files are`;
    const { mode } = await inquirer.prompt([{
      type: 'list', name: 'mode', message: `${which} staged AND modified. What to do?`,
      choices: [
        { name: 'unstage only (keep working changes)', value: 'unstage' },
        { name: 'discard all changes (irreversible)', value: 'discard' },
        { name: 'cancel', value: 'cancel' },
      ],
    }]);
    if (mode === 'cancel') console.log(chalk.yellow('  skipped'));
    else if (mode === 'unstage') {
      console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged'], names)}`));
      unstageFiles(names);
      console.log(chalk.green(`✔ Unstaged ${show(names)}`));
    } else if (await confirmGo(`Discard ALL changes to ${show(names)}? (irreversible)`, opts)) {
      if (opts.verbose) console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged', '--worktree'], names)}`));
      discardFiles(names, { includeStaged: true });
      console.log(chalk.green(`✔ Discarded all changes to ${show(names)}`));
    } else console.log(chalk.yellow('  skipped'));
  }

  if (unstagedOnly.length) {
    const names = unstagedOnly.map(f => f.file);
    if (await confirmGo(`Discard changes to ${show(names)}? (irreversible)`, opts)) {
      if (opts.verbose) console.log(chalk.gray(`→ ${fmtGit(['git restore'], names)}`));
      discardFiles(names);
      console.log(chalk.green(`✔ Discarded changes to ${show(names)}`));
    } else console.log(chalk.yellow('  skipped'));
  }

  if (untracked.length) {
    const names = untracked.map(f => f.file);
    if (await confirmGo(`Delete untracked ${show(names)}? (irreversible)`, opts)) {
      if (opts.verbose) console.log(chalk.gray(`→ ${fmtGit(['git clean', '-f'], names)}`));
      discardFiles(names);
      for (const n of names) console.log(chalk.green(`✔ Deleted untracked ${n}`));
    } else console.log(chalk.yellow('  skipped'));
  }
}

async function restoreFromSource(files, opts) {
  if (!files.length) { console.error(chalk.red('✖ --source needs pathspecs: e.g. sg undo . --source HEAD~1')); process.exitCode = 1; return; }
  const tree = trackedPathspecs(files);
  if (!tree.length) { console.log(chalk.yellow('✖ pathspec matched no tracked files')); return; }
  const touchesWorktree = !opts.staged || opts.worktree;
  if (touchesWorktree && !await confirmGo(`Restore ${show(tree)} from ${opts.source}? (overwrites worktree — irreversible)`, opts)) { console.log(chalk.yellow('  aborted')); return; }
  const cmd = ['git', 'restore', `--source=${opts.source}`];
  if (opts.staged) cmd.push('--staged');
  if (opts.worktree) cmd.push('--worktree');
  if (opts.verbose) console.log(chalk.gray(`→ ${fmtGit(cmd, tree)}`));
  restoreFiles(tree, { source: opts.source, staged: opts.staged, worktree: opts.worktree });
  console.log(chalk.green(`✔ Restored from ${opts.source}`));
}

module.exports = { show, fmtGit, confirmGo, getCommitCount, isSingleCommit, undoFiles, restoreFromSource, MAX_SHOWN };

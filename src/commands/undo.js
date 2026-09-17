const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const {
  ensureGitRepo, runGit, getChangedFiles, unstageFiles, discardFiles,
  expandPathspecs, trackedPathspecs, countUntracked, restoreFiles,
} = require('../utils/git');

const MAX_SHOWN = 5;

function show(list) {
  if (!list.length) return '';
  if (list.length <= MAX_SHOWN) return list.join(', ');
  return `${list.slice(0, MAX_SHOWN).join(', ')} … (+${list.length - MAX_SHOWN} more)`;
}

// Print the equivalent git command for transparency, capping long file lists.
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

  // ── targeted mode: explicit `git restore` parity (--staged / --worktree) ──
  if (opts.staged || opts.worktree) {
    if (untracked.length) {
      console.log(chalk.yellow(`✖ Untracked — nothing to restore: ${show(untracked.map(f => f.file))} (use \`sg clean\`)`));
    }
    const names = tracked.map(f => f.file);
    if (!names.length) return;
    if (opts.staged) {
      console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged'], names)}`));
      unstageFiles(names);
      console.log(chalk.green(`✔ Unstaged ${show(names)} (changes kept)`));
    }
    if (opts.worktree || !opts.staged) {
      if (!await confirmGo(`Discard worktree changes to ${show(names)}? (irreversible)`, opts)) {
        console.log(chalk.yellow('  aborted'));
        return;
      }
      console.log(chalk.gray(`→ ${fmtGit(['git restore', '--worktree'], names)}`));
      discardFiles(names);
      console.log(chalk.green(`✔ Discarded changes to ${show(names)}`));
    }
    return;
  }

  // ── auto mode: classify each file (staged-only → unstage, unstaged → discard) ──
  const stagedOnly = tracked.filter(f => f.staged && !f.unstaged);
  const unstagedOnly = tracked.filter(f => f.unstaged && !f.staged);
  const both = tracked.filter(f => f.staged && f.unstaged);

  // unstage is reversible — no confirm needed, batch it
  if (stagedOnly.length) {
    const names = stagedOnly.map(f => f.file);
    console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged'], names)}`));
    unstageFiles(names);
    console.log(chalk.green(`✔ Unstaged ${show(names)} (changes kept)`));
  }

  // staged AND modified (e.g. MM) — one grouped choice
  if (both.length) {
    const names = both.map(f => f.file);
    const which = names.length === 1 ? `"${names[0]}" is` : `${names.length} files are`;
    const { mode } = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: `${which} staged AND modified. What to do?`,
      choices: [
        { name: 'unstage only (keep working changes)', value: 'unstage' },
        { name: 'discard all changes (irreversible)', value: 'discard' },
        { name: 'cancel', value: 'cancel' },
      ],
    }]);
    if (mode === 'cancel') { console.log(chalk.yellow('  skipped')); }
    else if (mode === 'unstage') {
      console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged'], names)}`));
      unstageFiles(names);
      console.log(chalk.green(`✔ Unstaged ${show(names)}`));
    } else if (await confirmGo(`Discard ALL changes to ${show(names)}? (irreversible)`, opts)) {
      console.log(chalk.gray(`→ ${fmtGit(['git restore', '--staged', '--worktree'], names)}`));
      discardFiles(names, { includeStaged: true });
      console.log(chalk.green(`✔ Discarded all changes to ${show(names)}`));
    } else {
      console.log(chalk.yellow('  skipped'));
    }
  }

  // unstaged-only worktree changes — one grouped confirm instead of N prompts
  if (unstagedOnly.length) {
    const names = unstagedOnly.map(f => f.file);
    if (await confirmGo(`Discard changes to ${show(names)}? (irreversible)`, opts)) {
      console.log(chalk.gray(`→ ${fmtGit(['git restore'], names)}`));
      discardFiles(names);
      console.log(chalk.green(`✔ Discarded changes to ${show(names)}`));
    } else {
      console.log(chalk.yellow('  skipped'));
    }
  }

  // untracked files only ever arrive from exact path arguments (broad
  // pathspecs skip them, exactly like `git restore`) — so this is safe
  if (untracked.length) {
    const names = untracked.map(f => f.file);
    if (await confirmGo(`Delete untracked ${show(names)}? (irreversible)`, opts)) {
      console.log(chalk.gray(`→ ${fmtGit(['git clean', '-f'], names)}`));
      discardFiles(names);
      for (const n of names) console.log(chalk.green(`✔ Deleted untracked ${n}`));
    } else {
      console.log(chalk.yellow('  skipped'));
    }
  }
}

async function restoreFromSource(files, opts) {
  if (!files.length) {
    console.error(chalk.red('✖ --source needs pathspecs: e.g. sg undo . --source HEAD~1'));
    process.exitCode = 1;
    return;
  }
  const tree = trackedPathspecs(files);
  if (!tree.length) {
    console.log(chalk.yellow('✖ pathspec matched no tracked files'));
    return;
  }
  const touchesWorktree = !opts.staged || opts.worktree;
  if (touchesWorktree && !await confirmGo(`Restore ${show(tree)} from ${opts.source}? (overwrites worktree — irreversible)`, opts)) {
    console.log(chalk.yellow('  aborted'));
    return;
  }
  const cmd = ['git', 'restore', `--source=${opts.source}`];
  if (opts.staged) cmd.push('--staged');
  if (opts.worktree) cmd.push('--worktree');
  console.log(chalk.gray(`→ ${fmtGit(cmd, tree)}`));
  restoreFiles(tree, { source: opts.source, staged: opts.staged, worktree: opts.worktree });
  console.log(chalk.green(`✔ Restored from ${opts.source}`));
}

const undo = new Command('undo')
  .description('Safe undo — revert last commit, unstage or discard files with confirm (a `git restore` superset)')
  .argument('[files...]', 'files or pathspecs to unstage/discard (".", "src/", "*.js") — e.g. sg undo . restores everything')
  .option('--soft', 'soft reset (keep staged)')
  .option('--hard', 'hard reset (discard all) — requires confirm')
  .option('--commit <hash>', 'undo specific commit via revert')
  .option('--source <ref>', 'restore selected paths from a revision (git restore --source <ref>)')
  .option('--staged', 'only touch the index — unstage files (git restore --staged)')
  .option('--worktree', 'only touch the worktree (combine with --staged for both)')
  .option('--patch', 'pick hunks interactively (git restore -p)')
  .option('--yes', 'skip discard confirmation (sg undo <file>)')
  .action(async (...args) => {
    let files = [];
    let opts = {};
    for (const a of args) {
      if (Array.isArray(a)) files = a;
      else if (a && typeof a === 'object') {
        opts = typeof a.opts === 'function' ? a.opts() : a;
      }
    }
    ensureGitRepo();

    // ── git restore pass-through modes (full parity — git drives the prompts) ──
    if (opts.patch) {
      console.log(chalk.gray(files.length ? `→ git restore -p${opts.source ? ` --source=${opts.source}` : ''} -- ${files.join(' ')}` : `→ git restore -p${opts.source ? ` --source=${opts.source}` : ''} (all changed files)`));
      restoreFiles(files, { patch: true, source: opts.source, interactive: true });
      console.log(chalk.green('✔ Patch restore finished (git asked per hunk)'));
      return;
    }
    if (opts.source) {
      await restoreFromSource(files, opts);
      return;
    }

    if (files.length) {
      await undoFiles(files, opts);
      return;
    }

    if (opts.commit) {
      console.log(chalk.gray(`→ git revert ${opts.commit}`));
      try { runGit(['revert', opts.commit]); console.log(chalk.green('✔ Reverted')); } catch(e){ console.error(chalk.red(e.message));}
      return;
    }

    // Show last commit
    const last = runGit('log -1 --oneline', { allowError: true }) || '(no commits)';
    const status = runGit('status --porcelain', { allowError: true }) || '';
    console.log(chalk.bold.cyan('▸ smart undo'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`${chalk.bold('Last commit:')} ${chalk.yellow(last)}`);
    if (status) console.log(`${chalk.bold('Working tree:')} ${chalk.red('dirty')} (${status.split('\n').filter(Boolean).length} file(s) changed)`);
    else console.log(`${chalk.bold('Working tree:')} ${chalk.green('clean')}`);

    const single = isSingleCommit();

    if (opts.hard) {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Hard reset will discard ALL local changes. Are you sure?'), default: false }]);
      if (!ok) { console.log(chalk.yellow('Aborted.')); return; }
      if (single) {
        runGit('update-ref -d HEAD', { allowError: true });
        runGit('reset --hard', { allowError: true });
        try { runGit('clean -fd', { allowError: true }); } catch {}
        console.log(chalk.green('✔ Hard undone: initial commit removed, working tree reset'));
      } else {
        runGit('reset --hard HEAD~1');
        console.log(chalk.green('✔ Hard undone: last commit discarded, working tree reset'));
      }
      return;
    }

    if (opts.soft) {
      if (single) {
        runGit('update-ref -d HEAD', { allowError: true });
        console.log(chalk.green('✔ Soft undone: initial commit undone, changes remain staged'));
        console.log(chalk.gray('→ use `sg commit` to recommit or `sg status` to review'));
      } else {
        runGit('reset --soft HEAD~1');
        console.log(chalk.green('✔ Soft undone: last commit undone, changes remain staged'));
        console.log(chalk.gray('→ use `sg commit` to recommit or `sg status` to review'));
      }
      return;
    }

    // Interactive
    const { mode } = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: 'How to undo?',
      choices: [
        { name: 'soft  — undo commit, keep staged (safe)', value: 'soft' },
        { name: 'mixed — undo commit, keep unstaged (default git)', value: 'mixed' },
        { name: 'hard  — discard commit + all changes (danger)', value: 'hard' },
        { name: 'revert — create new commit that reverts last (safe for pushed)', value: 'revert' },
        { name: 'cancel', value: 'cancel' },
      ]
    }]);

    if (mode === 'cancel') return;

    if (mode === 'revert') {
      try {
        runGit('revert HEAD --no-edit');
        console.log(chalk.green('✔ Reverted HEAD with new commit'));
      } catch(e) {
        console.error(chalk.red('Revert failed:'), e.message);
      }
      return;
    }

    if (mode === 'hard') {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Confirm hard reset?'), default: false }]);
      if (!ok) return;
    }

    if (single) {
      if (mode === 'soft') {
        runGit('update-ref -d HEAD', { allowError: true });
        console.log(chalk.green(`✔ Undone initial commit with --soft (staged)`));
      } else if (mode === 'mixed') {
        runGit('update-ref -d HEAD', { allowError: true });
        runGit('reset', { allowError: true });
        console.log(chalk.green(`✔ Undone initial commit with --mixed (unstaged)`));
      } else {
        runGit('update-ref -d HEAD', { allowError: true });
        runGit('reset --hard', { allowError: true });
        try { runGit('clean -fd', { allowError: true }); } catch {}
        console.log(chalk.green(`✔ Undone initial commit with --hard`));
      }
      return;
    }

    const cmd = mode === 'soft' ? 'reset --soft HEAD~1' : mode === 'mixed' ? 'reset HEAD~1' : 'reset --hard HEAD~1';
    try {
      runGit(cmd);
      console.log(chalk.green(`✔ Undone with --${mode}`));
    } catch(e) {
      console.error(chalk.red('Undo failed:'), e.message);
    }
  });

module.exports = undo;
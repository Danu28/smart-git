const { Command } = require('commander');
const chalk = require('chalk');

// In-terminal playbook. Keep in sync with the README "Playbook" section —
// both answer "how do I get the most out of sg".

const SECTIONS = [
  {
    title: 'Daily golden path',
    lines: [
      '  sg status   # one glance: branch, ahead/behind, stashes, and what to do next',
      '  sg diff     # staged/unstaged stats + summary (--patch for the full diff)',
      '  sg commit   # interactive conventional commit (type → subject → details? → confirm)',
      '  sg sync     # fetch → pull --rebase → push — only the steps that are actually needed',
    ],
  },
  {
    title: 'Commit power moves',
    lines: [
      '  sg commit -m "fix(ui): x"            fast path; auto-stages if nothing staged',
      '  sg commit src/foo.js                 commit only that file',
      '  sg commit -p                         patch-stage: commit hunks, not files',
      '  sg commit --amend -m "..."           warns when the commit is already pushed',
      '  sg log --search auth --author you    find anything in history',
    ],
  },
  {
    title: 'When things go sideways',
    lines: [
      '  sg doctor      # first move when confused: mid-rebase? conflicts? detached? gone upstream?',
      '  sg continue    # after resolving conflicts: resume whatever rebase/merge/cherry-pick is running',
      '  sg abort       # roll back the in-progress operation (confirm-guarded)',
      '  sg undo        # last commit: --soft/--hard/--commit <hash>; sg undo <file> = unstage/discard a file',
      '  sg rescue      # after reset --hard or branch -D: find ✖ LOST commits, rescue/<hash> branch',
      '  sg fixup <sha> # fix a past commit: fixup! + autosquash in one go',
    ],
  },
  {
    title: 'Housekeeping',
    lines: [
      '  sg clean        # preview-before-delete untracked cleanup; .env/*.pem/id_rsa need --force',
      '  sg untrack .env # stop tracking, keep on disk, offers .gitignore',
      '  sg ignore "*.log" # append patterns (dedupe); warns if still tracked',
      '  sg cleanup      # delete merged branches + prune remotes (--dry-run first)',
      '  sg stash        # interactive stash manager (push/pop/apply/drop/show)',
    ],
  },
  {
    title: 'Team',
    lines: [
      '  sg pr           # push + gh pr create --fill (--draft/--web); compare URL without gh',
      '  sg why src/foo.js:12  # who wrote that line and why — blame without the wall',
    ],
  },
  {
    title: 'Safety contract',
    lines: [
      '  - destructive ops (undo --hard, clean, abort, cleanup) always confirm; --yes/--force skips',
      '  - --dry-run on every mutating command (sync, cleanup, commit, fixup, pr, clean)',
      '  - nothing touches the remote except sg sync and sg pr',
      '  - all git calls are shell-safe: spaces, &, $, quotes are passed literally',
      '  - per-command details: sg guide <command>',
      '  - full index: sg --help',
    ],
  },
];

function printPlaybook() {
  console.log(chalk.bold.cyan('▸ smart-git playbook — get the most out of sg'));
  console.log(chalk.gray('─'.repeat(40)));
  for (const s of SECTIONS) {
    console.log(chalk.bold(s.title));
    s.lines.forEach((l) => console.log(l));
    console.log();
  }
}

function printCommandHelp(topic) {
  // Deferred require: index.js loads this module at startup, so requiring
  // back at module scope would be a circular dependency. Inside the action
  // the program is fully constructed.
  const { program } = require('../index');
  const names = new Map();
  for (const c of program.commands) {
    names.set(c.name(), c);
    for (const a of c.aliases()) names.set(a, c);
  }
  const cmd = names.get(topic.toLowerCase());
  if (!cmd) {
    console.error(chalk.red(`✖ Unknown command "${topic}". `) + chalk.cyan('sg --help') + chalk.red(' lists everything.'));
    process.exit(1);
  }
  console.log(chalk.bold.cyan(`▸ sg ${cmd.name()}`) + chalk.gray(` — ${cmd.description() || ''}`));
  console.log(chalk.gray('─'.repeat(40)));
  const opts = cmd.options.filter((o) => o.flags);
  if (opts.length) {
    console.log(chalk.bold('Options:'));
    for (const o of opts) console.log(`  ${chalk.cyan(o.flags)}  ${chalk.gray(o.description || '')}`);
  } else {
    console.log(chalk.gray('(no options)'));
  }
  console.log();
  console.log(chalk.gray('Workflow hints: ') + chalk.cyan('sg guide') + chalk.gray(' for the full playbook, ') + chalk.cyan('sg --help') + chalk.gray(' for the index.'));
}

const guide = new Command('guide')
  .description('In-terminal playbook — golden path, recovery, housekeeping, team; `sg guide <command>` shows one command')
  .argument('[command]', 'show details for a specific command (e.g. sg guide commit)')
  .action((topic) => {
    if (topic) printCommandHelp(topic);
    else printPlaybook();
  });

module.exports = guide;
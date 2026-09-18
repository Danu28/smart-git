#!/usr/bin/env node
const chalk = require('chalk');
const { program } = require('../src/index');

// Context-aware sg default triage (S1) — replaces plain help with 30s golden path
if (!process.argv.slice(2).length) {
  try {
    const { isGitRepo } = require('../src/utils/git');
    const { getBranchState, getOperationState, getUnmergedPaths, hasCommits } = require('../src/utils/git-state');
    const { getStatusPorcelain, getChangedFiles } = require('../src/utils/git');
    if (!isGitRepo()) {
      console.log(chalk.bold.cyan('▸ smart-git triage — not a git repo'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  ${chalk.cyan('git init')}  create a new repo`);
      console.log(`  ${chalk.cyan('sg init --hooks')}  after init, install hooks`);
      console.log(chalk.gray('─'.repeat(40)));
      program.outputHelp();
      process.exit(0);
    }
    const op = getOperationState();
    const unmerged = getUnmergedPaths();
    const b = getBranchState();
    const porcelain = getStatusPorcelain() || '';
    const dirtyCount = porcelain.split('\n').filter(Boolean).length;
    const has = hasCommits();
    if (op.operation || unmerged.length) {
      console.log(chalk.bold.cyan('▸ smart-git triage — action needed'));
      console.log(chalk.gray('─'.repeat(40)));
      if (op.operation) console.log(chalk.red(`  ⚠ ${op.operation} in progress`));
      if (unmerged.length) console.log(chalk.red(`  ✖ ${unmerged.length} conflicted: ${unmerged.join(', ')}`));
      console.log(`  ${chalk.cyan('sg doctor')}  diagnose,  ${chalk.cyan('sg resolve')}  pick ours/theirs,  ${chalk.cyan('sg continue')}/${chalk.cyan('sg abort')}`);
      console.log(chalk.gray('─'.repeat(40)));
      program.outputHelp();
      process.exit(0);
    }
    if (dirtyCount) {
      const files = getChangedFiles().slice(0,5).map(f=>f.file).join(', ');
      console.log(chalk.bold.cyan('▸ smart-git triage — you have changes'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  ${chalk.yellow(dirtyCount+' file(s)')} ${files? chalk.gray(files):''} ${dirtyCount>5? chalk.gray(`+${dirtyCount-5} more`):''}`);
      if (b.behind) console.log(chalk.magenta(`  ↓ ${b.behind} behind`));
      if (b.ahead) console.log(chalk.yellow(`  ↑ ${b.ahead} ahead`));
      console.log(`  ${chalk.cyan('1')} sg status  — see what changed`);
      console.log(`  ${chalk.cyan('2')} sg diff    — staged vs unstaged`);
      console.log(`  ${chalk.cyan('3')} sg commit  — 2 prompts + AI draft (inferred)`);
      console.log(chalk.gray('─'.repeat(40)));
      program.outputHelp();
      process.exit(0);
    }
    if (b.behind || b.ahead) {
      console.log(chalk.bold.cyan('▸ smart-git triage — sync needed'));
      console.log(chalk.gray('─'.repeat(40)));
      if (b.behind) console.log(chalk.magenta(`  ↓ ${b.behind} behind remote`));
      if (b.ahead) console.log(chalk.yellow(`  ↑ ${b.ahead} ahead`));
      console.log(`  ${chalk.cyan('sg sync')}  fetch → pull --rebase → push`);
      console.log(`  ${chalk.cyan('sg log --search <term>')}  find history`);
      console.log(chalk.gray('─'.repeat(40)));
      program.outputHelp();
      process.exit(0);
    }
    console.log(chalk.bold.cyan('▸ smart-git triage — clean & up to date'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.green('  ✔ Working tree clean'));
    if (has) {
      const last = require('../src/utils/git').runGit('log -1 --oneline', {allowError:true})||'';
      if (last) console.log(`  Last: ${last}`);
    } else console.log(chalk.yellow('  No commits yet — sg commit to start'));
    console.log(`  ${chalk.cyan('sg log')}  history,  ${chalk.cyan('sg branch')}  branches,  ${chalk.cyan('sg guide')}  playbook`);
    console.log(chalk.gray('─'.repeat(40)));
    program.outputHelp();
    process.exit(0);
  } catch(e) {
    program.outputHelp();
    process.exit(0);
  }
}

// parseAsync + catch: async command errors surface as a clean `✖ <message>`
// instead of an unhandled-rejection stack trace (audit pass 2 findings 1/3/4).
// UserError is the expected user-facing failure — no stack, exit 1.
program.parseAsync(process.argv).catch((err) => {
  const msg = (err && err.message) || String(err);
  // UserError already has clean message; suppress stack for all expected errors
  console.error(chalk.red(`✖ ${msg}`));
  if (process.env.SMART_GIT_DEBUG) console.error(err.stack);
  process.exit(1);
});

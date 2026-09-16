const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getDiffSummary } = require('../utils/git');
const { COMMIT_TYPES, smartCommitMessage } = require('../utils/config');

const commit = new Command('commit')
  .description('Smart commit — conventional commits, interactive, auto-stage, lint (improves `git commit`)')
  .alias('c')
  .option('-m, --message <msg>', 'commit message directly (bypass prompts)')
  .option('-a, --all', 'stage all modified files')
  .option('--amend', 'amend last commit')
  .option('--dry-run', 'show what would be committed without committing')
  .option('--no-verify', 'bypass hooks')
  .action(async (opts) => {
    ensureGitRepo();

    const status = runGit('status --porcelain', { allowError: true }) || '';
    if (!status.trim() && !opts.amend) {
      console.log(chalk.yellow('No changes to commit. Working tree clean.'));
      return;
    }

    if (opts.message) {
      if (opts.all) runGit('add -A');
      const verify = opts.verify === false ? ' --no-verify' : '';
      const amend = opts.amend ? ' --amend' : '';
      runGit(`commit -m "${opts.message.replace(/"/g, '\\"')}"${amend}${verify}`, { silent: false });
      console.log(chalk.green('✔ Committed with message:'), opts.message);
      return;
    }

    // Interactive mode
    console.log(chalk.bold.cyan('▸ smart-commit — conventional commit builder'));
    console.log(chalk.gray('─'.repeat(40)));
    if (status) {
      const stat = getDiffSummary(false) || getDiffSummary(true) || status.slice(0, 500);
      console.log(chalk.gray('Changes:'));
      console.log(chalk.gray(stat.split('\n').slice(0, 10).join('\n')));
      console.log(chalk.gray('─'.repeat(40)));
    }

    const answers = await inquirer.prompt([
      { type: 'list', name: 'type', message: 'Commit type:', choices: COMMIT_TYPES, default: 'feat' },
      { type: 'input', name: 'scope', message: 'Scope (optional, e.g. api, ui):' },
      { type: 'input', name: 'subject', message: 'Subject (short description):', validate: v => v.length >= 3 && v.length <= 72 || '3-72 chars required' },
      { type: 'input', name: 'body', message: 'Body (optional, longer description):' },
      { type: 'input', name: 'breaking', message: 'Breaking change (optional):' },
      { type: 'input', name: 'issues', message: 'Closes issues (e.g. #123):' },
      { type: 'confirm', name: 'stageAll', message: 'Stage all changes (git add -A)?', default: true, when: () => !!status },
      { type: 'confirm', name: 'confirm', message: 'Create commit?', default: true },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('Aborted.'));
      return;
    }

    if (answers.stageAll) {
      console.log(chalk.gray('→ git add -A'));
      runGit('add -A');
    } else {
      // Show what is staged
      const staged = runGit('diff --cached --stat', { allowError: true });
      if (!staged) {
        const { doStage } = await inquirer.prompt([{ type: 'confirm', name: 'doStage', message: 'Nothing staged. Stage all now?', default: true }]);
        if (doStage) runGit('add -A');
        else { console.log(chalk.yellow('Nothing staged, aborted. Use `sg commit --all` or `git add`')); return; }
      }
    }

    const fullMessage = smartCommitMessage(answers.type, answers.scope.trim(), answers.subject.trim(), answers.body.trim(), answers.breaking.trim(), answers.issues.trim());

    if (opts.dryRun) {
      console.log(chalk.cyan('\n[Dry-run] Would commit with message:\n'));
      console.log(chalk.white(fullMessage));
      return;
    }

    // Create commit via temp file to preserve newlines
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `smart-git-${Date.now()}.txt`);
    fs.writeFileSync(tmp, fullMessage);
    const verify = opts.verify === false ? ' --no-verify' : '';
    const amend = opts.amend ? ' --amend' : '';
    try {
      runGit(`commit -F "${tmp}"${amend}${verify}`);
      console.log(chalk.green('✔ Committed:'));
      console.log(chalk.white(fullMessage.split('\n')[0]));
      const last = runGit('log -1 --oneline');
      console.log(chalk.gray(last));
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  });

module.exports = commit;

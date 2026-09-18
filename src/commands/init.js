const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');
const { getGitDir } = require('../utils/git-state');
const { UserError } = require('../utils/errors');

const init = new Command('init')
  .description('Init helpers — install hooks, setup repo (AU1)')
  .option('--hooks', 'install git hooks (pre-commit conventional lint, pre-push doctor, post-merge prune hint)')
  .option('--no-hooks', 'remove smart-git hooks')
  .action((opts) => {
    ensureGitRepo();
    const gitDir = getGitDir();
    if (!gitDir) { throw new UserError('No .git dir'); }
    const hooksDir = path.join(gitDir, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hasHooks = opts.hooks;
    if (opts.hooks === false) {
      // remove
      ['pre-commit','pre-push','post-merge'].forEach(h=>{
        const p = path.join(hooksDir, h);
        try { const txt = fs.readFileSync(p,'utf8'); if(txt.includes('smart-git')) fs.unlinkSync(p); } catch {}
      });
      console.log(chalk.green('✔ Removed smart-git hooks'));
      return;
    }
    if (!opts.hooks) {
      console.log(chalk.bold.cyan('▸ sg init'));
      console.log(chalk.gray('Usage: sg init --hooks    install hooks'));
      console.log(chalk.gray('       sg init --no-hooks remove hooks'));
      return;
    }
    // pre-commit: block wip, enforce conventional on staged commit msg? simple check
    const preCommit = `#!/bin/sh\n# smart-git pre-commit — conventional lint\nmsg=$(git log --pretty=%s -1 2>/dev/null || echo "")\nif echo "$msg" | grep -qi "^wip"; then echo "✖ wip not allowed"; exit 1; fi\nexit 0\n`;
    const prePush = `#!/bin/sh\n# smart-git pre-push — doctor check\nif git rev-parse --verify HEAD >/dev/null 2>&1; then git diff --name-only --diff-filter=U | grep -q . && { echo "✖ unmerged files"; exit 1; }; fi\nexit 0\n`;
    const postMerge = `#!/bin/sh\n# smart-git post-merge — prune hint\necho "→ smart-git: consider sg tidy --merged"\nexit 0\n`;
    fs.writeFileSync(path.join(hooksDir,'commit-msg'), commitMsg, {mode:0o755});
    fs.writeFileSync(path.join(hooksDir,'pre-push'), prePush, {mode:0o755});
    fs.writeFileSync(path.join(hooksDir,'post-merge'), postMerge, {mode:0o755});
    try { fs.chmodSync(path.join(hooksDir,'commit-msg'),0o755); fs.chmodSync(path.join(hooksDir,'pre-push'),0o755); fs.chmodSync(path.join(hooksDir,'post-merge'),0o755); } catch {}
    console.log(chalk.green('✔ Installed hooks: commit-msg, pre-push, post-merge'));
    console.log(chalk.gray(`  in ${hooksDir}`));
  });
module.exports = init;
const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');
const { spawnSync } = require('child_process');
const { UserError } = require('../utils/errors');

const worktree = new Command('worktree')
  .description('Worktree helpers — parallel review without switching branches (AU4)')
  .argument('[action]', 'add|list|remove (default: list)')
  .argument('[path]', 'worktree path (for add/remove)')
  .option('--branch <name>', 'branch for new worktree (with add)')
  .option('--force', 'force remove')
  .action((action, pathArg, opts) => {
    ensureGitRepo();
    const act = (action || 'list').toLowerCase();
    if (act === 'list' || act === '') {
      const out = runGit('worktree list', { allowError:true }) || '';
      console.log(chalk.bold.cyan('▸ worktrees'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(out || chalk.gray('(no worktrees)'));
      console.log(chalk.gray('Use: sg worktree add --branch fix/foo ../fix-foo'));
      return;
    }
    if (act === 'add') {
      if (!pathArg) { throw new UserError('sg worktree add <path> --branch <name>'); }
      const branch = opts.branch;
      const final = branch ? ['worktree','add','-b',branch,pathArg] : ['worktree','add',pathArg];
      const r = spawnSync('git', final, { stdio:'inherit' });
      if (r.status!==0) throw new UserError(`git command failed (${r.status})`);
      console.log(chalk.green(`✔ Worktree at ${pathArg}${branch?` branch ${branch}`:''}`));
      return;
    }
    if (act === 'remove' || act === 'rm') {
      if (!pathArg) { throw new UserError('sg worktree remove <path>'); }
      const args = ['worktree','remove', ...(opts.force?['--force']:[]), pathArg];
      const r = spawnSync('git', args, { stdio:'inherit' });
      if (r.status!==0) throw new UserError(`git command failed (${r.status})`);
      console.log(chalk.green(`✔ Removed worktree ${pathArg}`));
      return;
    }
    throw new UserError(`Unknown action "${act}" — use add|list|remove`);
  });
module.exports = worktree;
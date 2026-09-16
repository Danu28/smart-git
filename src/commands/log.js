const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');

const log = new Command('log')
  .description('Smarter git log — graph, conventional grouping, search (improves `git log`)')
  .option('-n, --limit <n>', 'number of commits', '15')
  .option('--oneline', 'oneline view')
  .option('--graph', 'show graph', true)
  .option('--search <term>', 'search commit messages')
  .option('--author <name>', 'filter by author')
  .action((opts) => {
    ensureGitRepo();
    const limit = parseInt(opts.limit, 10) || 15;
    let args = '';
    if (opts.oneline) {
      args = `log --oneline --color=always -n ${limit}`;
    } else {
      args = `log --graph --pretty=format:"%C(yellow)%h%Creset %C(cyan)%ad%Creset %C(green)%an%Creset %s %C(red)%d%Creset" --date=short --color=always -n ${limit}`;
    }
    if (opts.search) args += ` --grep="${opts.search}"`;
    if (opts.author) args += ` --author="${opts.author}"`;

    const out = runGit(args, { allowError: true });
    if (!out) {
      console.log(chalk.yellow('No commits found.'));
      return;
    }
    console.log(chalk.bold.cyan(`▸ smart log — last ${limit}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(out);
    console.log(chalk.gray('─'.repeat(50)));

    // Stats
    try {
      const stats = runGit(`shortlog -sn --all -n | head -n 5`, { allowError: true });
      if (stats) {
        console.log(chalk.bold('Top contributors:'));
        console.log(chalk.gray(stats));
      }
    } catch {}
  });

module.exports = log;

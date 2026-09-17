const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');

const log = new Command('log')
  .description('Smarter git log — graph, conventional grouping, search (improves `git log`)')
  .option('-n, --limit <n>', 'number of commits', '15')
  .option('--oneline', 'oneline view')
  .option('--search <term>', 'search commit messages')
  .option('--author <name>', 'filter by author')
  .action((opts) => {
    ensureGitRepo();
    const limit = parseInt(opts.limit, 10) || 15;
    const baseArgs = opts.oneline
      ? ['log', '--oneline', '--color=always', '-n', String(limit)]
      : ['log', '--graph', '--pretty=format:%C(yellow)%h%Creset %C(cyan)%ad%Creset %C(green)%an%Creset %s %C(red)%d%Creset', '--date=short', '--color=always', '-n', String(limit)];
    if (opts.search) baseArgs.push(`--grep=${opts.search}`);
    if (opts.author) baseArgs.push(`--author=${opts.author}`);

    const out = runGit(baseArgs, { allowError: true });
    if (!out) {
      console.log(chalk.yellow('No commits found.'));
      return;
    }
    console.log(chalk.bold.cyan(`▸ smart log — last ${limit}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(out);
    console.log(chalk.gray('─'.repeat(50)));

    // Stats - JS truncation instead of head for Windows compatibility
    try {
      const rawStats = runGit(`shortlog -sn --all`, { allowError: true });
      if (rawStats) {
        const stats = rawStats.split('\n').slice(0, 5).join('\n');
        console.log(chalk.bold('Top contributors:'));
        console.log(chalk.gray(stats));
      }
    } catch {}
  });

module.exports = log;

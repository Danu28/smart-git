const { Command } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

const program = new Command();

program
  .name('smart-git')
  .alias('sg')
  .description(chalk.cyan('smart-git — a smarter git CLI that makes git safe, intuitive and fast'))
  .version(pkg.version, '-v, --version', 'output version')
  .helpOption('-h, --help', 'display help');

// Import commands
const statusCmd = require('./commands/status');
const logCmd = require('./commands/log');
const commitCmd = require('./commands/commit');
const branchCmd = require('./commands/branch');
const syncCmd = require('./commands/sync');
const undoCmd = require('./commands/undo');
const cleanupCmd = require('./commands/cleanup');
const diffCmd = require('./commands/diff');
const stashCmd = require('./commands/stash');

program.addCommand(statusCmd);
program.addCommand(logCmd);
program.addCommand(commitCmd);
program.addCommand(branchCmd);
program.addCommand(syncCmd);
program.addCommand(undoCmd);
program.addCommand(cleanupCmd);
program.addCommand(diffCmd);
program.addCommand(stashCmd);

module.exports = { program };

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
const switchCmd = require('./commands/switch');
const rescueCmd = require('./commands/rescue');
const doctorCmd = require('./commands/doctor');
const cleanCmd = require('./commands/clean');
const continueCmd = require('./commands/continue');
const abortCmd = require('./commands/abort');
const fixupCmd = require('./commands/fixup');
const untrackCmd = require('./commands/untrack');
const ignoreCmd = require('./commands/ignore');
const prCmd = require('./commands/pr');
const whyCmd = require('./commands/why');
const guideCmd = require('./commands/guide');
const resolveCmd = require('./commands/resolve');

program.addCommand(statusCmd);
program.addCommand(logCmd);
program.addCommand(commitCmd);
program.addCommand(branchCmd);
program.addCommand(switchCmd);
program.addCommand(syncCmd);
program.addCommand(undoCmd);
program.addCommand(cleanupCmd);
program.addCommand(diffCmd);
program.addCommand(stashCmd);
program.addCommand(rescueCmd);
program.addCommand(doctorCmd);
program.addCommand(cleanCmd);
program.addCommand(continueCmd);
program.addCommand(abortCmd);
program.addCommand(fixupCmd);
program.addCommand(untrackCmd);
program.addCommand(ignoreCmd);
program.addCommand(prCmd);
program.addCommand(whyCmd);
program.addCommand(guideCmd);
program.addCommand(resolveCmd);

module.exports = { program };

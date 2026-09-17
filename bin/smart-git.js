#!/usr/bin/env node
const chalk = require('chalk');
const { program } = require('../src/index');

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// parseAsync + catch: async command errors surface as a clean `✖ <message>`
// instead of an unhandled-rejection stack trace (audit pass 2 findings 1/3/4).
program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`✖ ${(err && err.message) || err}`));
  process.exit(1);
});

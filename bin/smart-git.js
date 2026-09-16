#!/usr/bin/env node
const { program } = require('../src/index');

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);

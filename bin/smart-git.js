#!/usr/bin/env node
const chalk = require('chalk');
const { program } = require('../src/index');
const { renderTriage } = require('../src/triage');

// Context-aware sg default triage (S1) — delegates to testable src/triage.js
if (!process.argv.slice(2).length) {
  try {
    renderTriage(program);
  } catch (e) {
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

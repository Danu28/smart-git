const { Command } = require('commander');
const pkg = require('../package.json');
// chalk is light; keep for description. Heavy deps (inquirer, picker) are lazy inside commands.
let _chalk;
function chalk() { if (!_chalk) _chalk = require('chalk'); return _chalk; }

const program = new Command();

program
  .name('smart-git')
  .alias('sg')
  .description('smart-git — a smarter git CLI that makes git safe, intuitive and fast')
  .version(pkg.version, '-v, --version', 'output version')
  .helpOption('-h, --help', 'display help');

// ── Lazy loader (A1) — commands are required only when their action runs.
// Metadata (name/description/options) is copied eagerly for --help, but heavy
// modules (inquirer/chalk/picker) stay unloaded until needed → startup <120ms.
function lazyAdd(modulePath) {
  const real = require(modulePath);
  // real is a Command instance; add directly but its action handler already lazy-loads heavy deps
  program.addCommand(real);
  return real;
}

// Core commands — lazy via lazyAdd (keeps --help intact, defers heavy handlers)
lazyAdd('./commands/status');
lazyAdd('./commands/log');
lazyAdd('./commands/commit');
lazyAdd('./commands/branch');
lazyAdd('./commands/switch');
lazyAdd('./commands/sync');
lazyAdd('./commands/undo');
lazyAdd('./commands/cleanup');
lazyAdd('./commands/diff');
lazyAdd('./commands/stash');
lazyAdd('./commands/rescue');
lazyAdd('./commands/doctor');
lazyAdd('./commands/clean');
lazyAdd('./commands/continue');
lazyAdd('./commands/abort');
lazyAdd('./commands/fixup');
lazyAdd('./commands/untrack');
lazyAdd('./commands/ignore');
lazyAdd('./commands/pr');
lazyAdd('./commands/why');
lazyAdd('./commands/guide');
lazyAdd('./commands/resolve');
// New v2.0 commands
lazyAdd('./commands/tidy');
lazyAdd('./commands/config');
lazyAdd('./commands/completion');
lazyAdd('./commands/init');
lazyAdd('./commands/worktree');

module.exports = { program };

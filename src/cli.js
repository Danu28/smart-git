const fs = require('fs');
const { trace, formatTable } = require('./trace');
const lens = require('./lens');
const VERSION = require('../package.json').version;
function help() {
  return 'smart-git v' + VERSION + ' - paste stacktrace -> ranked culprit\n\nUsage:\n  smart-git trace [--stacktrace <file>] [--limit N] [--json] [--oneline] [--verbose]\n    Reads stacktrace from file or stdin (pipe).\n  smart-git lens <hash> --preview        create worktree at hash\n  smart-git lens --exit [path]           remove lens worktree\n  smart-git --help | --version\n\nExamples:\n  npm start 2>&1 | smart-git trace\n  smart-git trace --stacktrace crash.log --json\n  smart-git lens abc123 --preview';
}
function parseArgs(argv) {
  const args = [...argv];
  const opts = { limit: 10, json: false, oneline: false, verbose: false, stacktrace: null };
  let cmd = args.shift();
  if (!cmd || cmd === '--help' || cmd === '-h') return { cmd: 'help' };
  if (cmd === '--version' || cmd === '-v') return { cmd: 'version' };
  if (cmd === 'trace') {
    while (args.length) {
      const a = args.shift();
      if (a === '--stacktrace' || a === '-f') opts.stacktrace = args.shift();
      else if (a === '--limit') opts.limit = parseInt(args.shift(),10) || 10;
      else if (a === '--json') opts.json = true;
      else if (a === '--oneline') opts.oneline = true;
      else if (a === '--verbose') opts.verbose = true;
      else if (a === '--help' || a === '-h') return { cmd: 'help' };
    }
    return { cmd: 'trace', opts };
  }
  if (cmd === 'lens') {
    let hash = null; let preview = false; let exit = false; let dest = null;
    while (args.length) {
      const a = args.shift();
      if (a === '--preview') preview = true;
      else if (a === '--exit') exit = true;
      else if (a.startsWith('--')) {}
      else if (!hash) hash = a; else dest = a;
    }
    if (exit) return { cmd: 'lens-exit', dest };
    if (preview && hash) return { cmd: 'lens-preview', hash };
    return { cmd: 'help' };
  }
  if (cmd === '--stacktrace') return { cmd: 'trace', opts: { ...opts, stacktrace: args.shift() } };
  return { cmd: 'help' };
}
async function readInput(stacktracePath) {
  if (stacktracePath) return fs.readFileSync(stacktracePath, 'utf8');
  if (process.stdin.isTTY) return '';
  return fs.readFileSync(0, 'utf8');
}
async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.cmd === 'help') { console.log(help()); process.exit(0); }
  if (parsed.cmd === 'version') { console.log(VERSION); process.exit(0); }
  try {
    if (parsed.cmd === 'trace') {
      const text = await readInput(parsed.opts.stacktrace);
      if (!text || !text.trim()) { console.error('No stacktrace input. Provide --stacktrace <file> or pipe via stdin.'); console.log(help()); process.exit(2); }
      const result = trace(text, parsed.opts);
      if (result.error && result.culprits.length === 0) { console.error(result.error); process.exit(1); }
      if (parsed.opts.json) console.log(JSON.stringify(result, null, 2));
      else { console.log(formatTable(result.culprits, parsed.opts)); if (parsed.opts.verbose) console.log('\nLocations:', JSON.stringify(result.locations, null, 2)); else if (result.culprits.length) console.log('\nTip: smart-git lens <hash> --preview  to inspect'); }
      process.exit(result.culprits.length ? 0 : 1);
    }
    if (parsed.cmd === 'lens-preview') { const r = lens.preview(parsed.hash); console.log('Worktree at ' + r.dest + '\n' + r.snippet + '\nRun: smart-git lens --exit ' + r.dest); process.exit(0); }
    if (parsed.cmd === 'lens-exit') { const d = lens.exitLens(parsed.dest); console.log('Removed ' + d); process.exit(0); }
  } catch (e) { console.error('Error:', e.message); if (process.env.DEBUG) console.error(e.stack); process.exit(2); }
}
module.exports = { main, parseArgs, help };

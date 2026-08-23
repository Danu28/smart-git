const fs = require('fs');
const { trace, formatTable } = require('./trace');
const lens = require('./lens');
const VERSION = require('../package.json').version;
function help() {
  return 'smart-git v' + VERSION + ' - paste stacktrace -> ranked culprit\n\nUsage:\n  smart-git trace ["<stacktrace string>"] [--stacktrace <file>] [--limit N] [--json] [--oneline] [--verbose]\n    Reads stacktrace from file, raw string, or stdin (pipe).\n  smart-git lens <hash> --preview        create worktree at hash\n  smart-git lens --exit [path]           remove lens worktree\n  smart-git --help | --version\n\nExamples:\n  npm start 2>&1 | smart-git trace\n  smart-git trace --stacktrace crash.log --json\n  smart-git trace "Error at foo (src/app.js:42:10)" --json\n  smart-git trace Exception in thread "main" java.lang.NullPointerException at com.example.App.calculateTotal(App.java:9)\n  smart-git lens abc123 --preview';
}
function parseArgs(argv) {
  const args = [...argv];
  const opts = { limit: 10, json: false, oneline: false, verbose: false, stacktrace: null, raw: null };
  let cmd = args.shift();
  if (!cmd || cmd === '--help' || cmd === '-h') return { cmd: 'help' };
  if (cmd === '--version' || cmd === '-v') return { cmd: 'version' };
  if (cmd === 'trace') {
    while (args.length) {
      const a = args.shift();
      if (a === '--stacktrace' || a === '-f') { const v=args.shift(); if(v===undefined){ console.error('Missing value for --stacktrace'); process.exit(2);} opts.stacktrace=v; }
      else if (a === '--limit') { const v=args.shift(); const n=parseInt(v,10); if(!Number.isInteger(n)||n<1||n>100){ console.error('Invalid --limit '+v); process.exit(2);} opts.limit=n; }
      else if (a === '--json') opts.json = true;
      else if (a === '--oneline') opts.oneline = true;
      else if (a === '--verbose') opts.verbose = true;
      else if (a === '--help' || a === '-h') return { cmd: 'help' };
      else if (a.startsWith('-')) { console.error('Unknown flag: ' + a); process.exit(2); }
      else {
        opts.raw = opts.raw ? opts.raw + ' ' + a : a;
        while (args.length && !args[0].startsWith('-')) opts.raw += ' ' + args.shift();
      }
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
      else if (exit && !dest) dest = a;
      else if (!hash) hash = a; else dest = a;
    }
    if (exit) return { cmd: 'lens-exit', dest: dest || hash };
    if (preview && hash) return { cmd: 'lens-preview', hash };
    return { cmd: 'help' };
  }
  return { cmd: 'help' };
}
async function readInput(stacktracePath, raw) {
  const NL = String.fromCharCode(92) + 'n';
  const toText = s => s.split(NL).join(String.fromCharCode(10));
  const readFile = s => { try { if (fs.existsSync(s)) return fs.readFileSync(s, 'utf8'); } catch {} return null; };
  // single input mode: explicit file wins, else raw string, else stdin
  if (stacktracePath) {
    if (!fs.existsSync(stacktracePath)) throw new Error('Stacktrace file not found: ' + stacktracePath);
    const f = readFile(stacktracePath);
    return f !== null ? f : '';
  }
  if (raw) return toText(raw);
  if (process.stdin.isTTY) return '';
  return readStdin();
}
// Read piped stdin. Resolves on 'end' (normal pipe) or on a timeout so an open
// pipe that never closes can't hang the process. Timeout only fires when no
// data ever arrives; a normal `cmd | smart-git trace` ends almost immediately.
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    let idleTimer;
    let watchTimer;
    const settle = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(watchTimer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
      if (typeof process.stdin.unref === 'function') process.stdin.unref();
      resolve(val);
    };
    const onData = (d) => {
      data += d;
      clearTimeout(watchTimer);                     // data is flowing: cancel the "no input" watchdog
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => settle(data), 100); // idle gap -> done
    };
    const onEnd = () => settle(data);
    const onError = () => settle(data);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    // No data within this window => treat as empty input rather than hanging on an
    // open pipe that never closes. Data that arrives later is still captured.
    // ponytail: live tails that stream forever are still out of scope.
    watchTimer = setTimeout(() => { if (!data) settle(''); }, 1000);
  });
}
async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.cmd === 'help') { console.log(help()); process.exit(0); }
  if (parsed.cmd === 'version') { console.log(VERSION); process.exit(0); }
  try {
    if (parsed.cmd === 'trace') {
      const text = await readInput(parsed.opts.stacktrace, parsed.opts.raw);
      if (!text || !text.trim()) { console.error('No stacktrace input. Provide "<stacktrace>" as arg, --stacktrace <file>, or pipe via stdin.'); console.log(help()); process.exit(2); }
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
module.exports = { main, parseArgs, help, readInput };

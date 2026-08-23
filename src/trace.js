const { parseStacktrace } = require('./parser');
const git = require('./git');
function trace(stacktraceText, opts = {}) {
  const root = git.gitRoot();
  const locations = parseStacktrace(stacktraceText).slice(0, 20); // ponytail: cap 20 stack frames, raise if needed
  if (locations.length === 0) return { root, locations: [], culprits: [], error: 'No file:line found in stacktrace' };
  const max = opts.limit || 10;
  const culprits = [];
  const seenHash = new Map();
  let allFiles = [];
  try { allFiles = git.sh('git ls-files', { cwd: root }).split(String.fromCharCode(10)).filter(Boolean); } catch {}
  for (const loc of locations) {
    const candidates = [loc.file, loc.file.split('/').pop()];
    let trackedFile = null;
    for (const f of candidates) {
      const hit = allFiles.find(x => x === f || x.endsWith('/' + f));
      if (hit) { trackedFile = hit; break; }
      if (git.isTracked(f, root)) { trackedFile = f; break; }
    }
    if (!trackedFile) trackedFile = loc.file;
    let blameHash = null;
    try { blameHash = git.blame(trackedFile, loc.line, root); } catch {}
    if (!blameHash) continue;
    let origin = blameHash;
    try { origin = git.szzOrigin(trackedFile, loc.line, blameHash, root); } catch {}
    const key = origin;
    if (seenHash.has(key)) { seenHash.get(key).locations.push({ ...loc, trackedFile }); continue; }
    let info;
    try { info = git.commitInfo(origin, root); } catch { info = { hash: origin.slice(0,12), fullHash: origin, author: '?', date: '?', message: '' }; }
    const whitespace = git.isWhitespaceOnly(origin, trackedFile, root);
    const culprit = {
      hash: info.hash, fullHash: info.fullHash, author: info.author, date: info.date, message: info.message,
      file: trackedFile, line: loc.line, blameHash: blameHash.slice(0,12),
      whitespaceOnly: whitespace,
      snippet: git.snippet(origin, trackedFile, root).slice(0, 800),
      locations: [{ ...loc, trackedFile }],
      score: whitespace ? 0 : (origin !== blameHash ? 2 : 1),
    };
    seenHash.set(key, culprit);
    culprits.push(culprit);
  }
  culprits.sort((a,b) => b.score - a.score || a.hash.localeCompare(b.hash));
  const ranked = culprits.slice(0, max);
  return { root, locations, culprits: ranked };
}
function formatTable(culprits, opts = {}) {
  if (!culprits.length) return 'No culprits found.';
  const oneline = !!opts.oneline;
  const NL = String.fromCharCode(10);
  if (oneline) return culprits.map(function(c){ return c.hash + ' ' + c.file + ':' + c.line + ' ' + c.message + (c.whitespaceOnly ? ' (whitespace)' : ''); }).join(NL);
  const header = 'rank  hash          author              date                 file:line               message';
  const sep = '-'.repeat(90);
  const rows = culprits.map(function(c,i){
    const rank = String(i+1).padEnd(4);
    const hash = c.hash.padEnd(12);
    const author = (c.author||'?').slice(0,18).padEnd(18);
    const date = (c.date||'?').slice(0,19).padEnd(19);
    const fl = (c.file + ':' + c.line).slice(0,22).padEnd(22);
    const msg = (c.message||'').slice(0,40) + (c.whitespaceOnly ? ' [whitespace]' : '');
    return rank + ' ' + hash + ' ' + author + ' ' + date + ' ' + fl + ' ' + msg;
  });
  return [header, sep].concat(rows).join(NL);
}
module.exports = { trace, formatTable };

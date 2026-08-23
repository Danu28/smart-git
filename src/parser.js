function parseStacktrace(text) {
  const seen = new Map();
  const res = [];
  // simple: match file extensions with :line
  const re = /([A-Za-z0-9_.\/\-]+\.(?:js|ts|mjs|cjs|jsx|tsx|py|java|go|rb|php)):(\d+)(?::\d+)?/g;
  const pyRe = /File\s+"([^"]+)",\s+line\s+(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let file = m[1].replace(/^\.\//, '');
    let line = parseInt(m[2], 10);
    if (!file || !line || line < 1 || line > 1000000) continue;
    if (file.includes('node_modules')) continue;
    let key = file + ':' + line;
    if (!seen.has(key)) { seen.set(key, true); res.push({ file, line }); }
  }
  pyRe.lastIndex = 0;
  while ((m = pyRe.exec(text)) !== null) {
    let file = m[1].replace(/^\.\//, '');
    let line = parseInt(m[2], 10);
    if (!line || line < 1 || line > 1000000) continue;
    let key = file + ':' + line;
    if (!seen.has(key)) { seen.set(key, true); res.push({ file, line }); }
  }
  if (res.length === 0) {
    const generic = /([A-Za-z0-9_.\/\-]+\.[a-z]{2,4}):(\d+)/g;
    while ((m = generic.exec(text)) !== null) {
      let file = m[1]; let line = +m[2];
      if (line < 1 || line > 1000000) continue;
      if (file.includes('node_modules')) continue;
      let key = file + ':' + line;
      if (!seen.has(key)) { seen.set(key, true); res.push({ file, line }); }
    }
  }
  return res;
}
module.exports = { parseStacktrace };

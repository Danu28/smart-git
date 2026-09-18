const PROTECTED_PATTERNS = [
  /^\.env$/,
  /^\.env\.[\w.-]+$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^\.gitconfig$/,
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/,
  /credentials/i,
  /secret/i,
];

const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'develop', 'dev'];

function basename(p) {
  return String(p).replace(/\\/g, '/').split('/').pop();
}

function isProtected(name) {
  const base = basename(String(name));
  return PROTECTED_PATTERNS.some((re) => re.test(base));
}

function isProtectedBranch(name) {
  return DEFAULT_PROTECTED_BRANCHES.includes(String(name).trim());
}

module.exports = { PROTECTED_PATTERNS, DEFAULT_PROTECTED_BRANCHES, basename, isProtected, isProtectedBranch };

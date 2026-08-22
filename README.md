# smart-git — Paste Stacktrace → Ranked Culprit in 10s

> Zero deps, only `git`. Finds the commit that introduced the bug, not just the last `git blame`.

`git blame` points to the last touch — often a Prettier/rename. `smart-git` parses any stacktrace (JS/TS, Python, Java, Go), runs `blame` + SZZ to find the **origin commit**, ranks culprits, and lets you preview the diff without stashing.

## Prerequisites
- **Node.js >= 18** and **git** on PATH
- Run **inside a git repo** — `smart-git` uses `git rev-parse`, `blame`, `log -G`, `show`, `worktree`

## Install

Package not yet published to npm. Install from GitHub or locally:

```bash
# from GitHub
npm install -g github:Danu28/smart-git

# or clone and link (dev)
git clone https://github.com/Danu28/smart-git.git
cd smart-git
npm link          # makes `smart-git` available globally
# or without link
node bin/smart-git --help
```

Local project use:
```bash
npm install --save-dev github:Danu28/smart-git
npx smart-git --help
```

## Usage

All commands must be run from inside your repo. Stacktraces are read from a file or stdin.

### `smart-git trace`

Find culprit commits for every `file:line` in a stacktrace.

```bash
# pipe (most common)
npm start 2>&1 | smart-git trace
cat crash.log | smart-git trace
cat crash.log | smart-git trace --oneline
cat crash.log | smart-git trace --json | jq

# paste raw string in quotes (new)
smart-git trace "Error at foo (src/app.js:42:10)"
smart-git trace "Error at foo (src/app.js:42:10)" --json
smart-git trace --stacktrace "Error at foo (src/app.js:42:10)" --oneline

# from file
smart-git trace --stacktrace crash.log
smart-git trace -f crash.log --limit 3 --oneline

# flags
# --stacktrace, -f <path>  read stacktrace from file (default: stdin)
# --limit <N>              top N culprits (default 10)
# --json                   machine-readable JSON (root, locations, culprits, snippet)
# --oneline                compact `hash file:line message`
# --verbose                also print parsed locations
# --help, --version
```

Exit codes: `0` found culprits, `1` no culprits / no file:line, `2` bad input / not a git repo.

Supported stack formats: Node/JS `at foo (src/app.js:42:10)`, Python `File "app.py", line 123`, Java `Foo.java:99`, Go `main.go:27` (deduplicates, ignores `node_modules`).

Example output (table):
```
rank  hash          author              date                 file:line               message
------------------------------------------------------------------------------------------
1    72eb8dec97f  Test               2026-08-22 19:46:59 src/app.js:1           feat: add bad call
```

### `smart-git lens`

Inspect culprit without stashing — ephemeral `git worktree`.

```bash
smart-git lens <hash> --preview   # creates /tmp/smart-git-lens-<hash>-<ts>, prints `git show --stat`
smart-git lens --exit             # removes the last lens worktree
smart-git lens --exit /tmp/smart-git-lens-...  # remove specific
```

## How it works
1. **Parse** regex → `file:line` → resolve via `git ls-files`
2. **Blame** → candidate hash → walk `git log -G` (SZZ lite) → origin hash
3. **Rank** — origin > last-touch; demote whitespace-only diffs (`--ignore-all-space`)
4. **Preview** — `git worktree add --detach` at culprit

## Dev

```bash
npm test                          # node --test (13 tests)
node bin/smart-git --help
echo 'Error\n at foo (src/parser.js:5:3)' | node bin/smart-git trace --json
```

## Troubleshooting

- `fatal: not a git repository` → `cd` into your repo first.
- `No file:line found in stacktrace` → file not matched by supported formats or paths are absolute — try `cat crash.log | smart-git trace --verbose` to see parsed locations.
- `No culprits found.` → file not tracked (`git ls-files`) or line out of range — ensure `src/app.js` is committed.

## Roadmap
- **v1.0** (this release): `trace` + `lens --preview/--exit` lite
- **v1.1**: `trace --semantic` (tree-sitter), `hunt --repro` (auto-bisect), `search --exception`

License: MIT

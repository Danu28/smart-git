# smart-git — Paste Stacktrace → Ranked Culprit in 10s

> Zero deps, only `git`. Finds the commit that introduced the bug, not just the last blame.

## Why
`git blame` points to the last touch — often a Prettier/rename commit. `smart-git` goes further: it parses any stacktrace (JS/TS, Python, Java, Go), runs `blame` + SZZ to find the **origin commit**, ranks culprits, and lets you preview the diff without stashing your work.

## Install
```bash
npm install -g smart-git
# or local
npm install smart-git
```

## Usage
```bash
# pipe
npm start 2>&1 | smart-git trace
cat crash.log | smart-git trace --oneline

# file
smart-git trace --stacktrace crash.log
smart-git trace --stacktrace crash.log --json | jq
smart-git trace --stacktrace crash.log --limit 3

# inspect culprit without stashing
smart-git lens <hash> --preview
smart-git lens --exit
```

## How it works
1. **Parse** stacktrace regex → `file:line` (maps to `git ls-files`)
2. **Blame** → candidate commit → walk `git log -G` (SZZ lite) → origin commit
3. **Rank** — origin > last-touch, demote whitespace-only diffs
4. **Preview** — ephemeral `git worktree` at culprit

## Dev
```bash
npm test          # node --test (baseline)
node bin/smart-git --help
```

## Roadmap
- v1.0: trace + lens lite (this release)
- v1.1: `trace --semantic` (tree-sitter), `hunt --repro` (auto-bisect), `search --exception`

License: MIT

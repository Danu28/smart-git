# smart-git v1.0 — Detailed Build Plan

## Requirements (refined)
1. Plan + build v1.0 from .get-ideas/v1.0.md spec — source: task
2. Zero deps, Node >=18, only git — ponytail
3. Two commands: trace + lens lite

## Architecture (4 files, no build step)
- `src/parser.js` — stacktrace regex (JS/TS/Python/Java/Go) -> file:line[]
- `src/git.js` — git plumbing: gitRoot, isTracked, blame, commitInfo, snippet, isWhitespaceOnly, szzOrigin, worktree helpers
- `src/trace.js` — trace(): parse -> resolve tracked file -> blame -> SZZ -> rank -> table/json
- `src/lens.js` — preview/exit via git worktree
- `src/cli.js` + `bin/smart-git` — arg parse, stdin/file input, help/version, exit codes
- `package.json` — bin linkage

## Tasks (priority order)
- [x] 1. Scaffold (package.json, bin, README)
- [x] 2. Parser
- [x] 3. Git helpers
- [x] 4. Trace (ranking, lite noise filter, table/json)
- [x] 5. Lens
- [x] 6. CLI router
- [x] 7. Smoke test (init temp repo, commit, trace, json, oneline)
- [x] 8. Polish: error messages, .harness/longterm/memory updates

## Out of scope (v1.1)
tree-sitter --semantic, hunt --repro, search --exception, lens --revert, PR/CI

## Acceptance
- `smart-git --help` / `--version` works
- `echo "at foo (src/app.js:1:2)" | smart-git trace --json` returns locations
- In a real git repo with history, trace returns ranked culprits with hash/author/message
- `smart-git lens <hash> --preview/--exit` worktree round-trip

# smart-git

> **A smarter, safer, more intuitive CLI that improves `git`.**

`smart-git` (`sg`) wraps git with interactive workflows, safety rails, and delightful UX — so you stop memorizing flags and start shipping.

## Why smart-git vs git?

| Pain with git | smart-git improvement |
|---|---|
| `git status` is plain | `sg status` shows ahead/behind, stash count, last commit, suggestions |
| `git log` noisy | `sg log` graph + search + top contributors |
| `git commit` forgets conventional commits | `sg commit` interactive builder, auto-stage, lint, dry-run |
| `git branch` + `checkout -b` + naming chaos | `sg branch --create` enforces `feat/`/`fix/` prefixes, safe delete, cleanup |
| `git pull`/`push` conflicts, no autostash | `sg sync` = stash → fetch --prune → pull --rebase → push, sets upstream |
| `git reset --hard` dangerous | `sg undo` confirms, offers soft/mixed/hard/revert with preview |
| Merged branches pile up | `sg cleanup` deletes merged branches + prunes remotes |
| `git diff` wall of text | `sg diff` staged vs unstaged stats + summary |
| `git stash` cryptic | `sg stash` interactive list/pop/apply/drop |

## Install — 1 command

### Easiest (from GitHub — no npm publish needed)
```bash
npm install -g github:Danu28/smart-git
# now use anywhere:
smart-git --help
sg --help
sg status
```

### From source (contributors)
```bash
git clone https://github.com/Danu28/smart-git.git
cd smart-git
npm install
npm link   # creates global `smart-git` + `sg` aliases
```

### Try without install (npx)
```bash
npx github:Danu28/smart-git --help
```

> Requires `git` and `Node >=14`. Works on Windows/macOS/Linux.

[![npm version](https://img.shields.io/badge/version-1.1.5-blue)]() [![license MIT](https://img.shields.io/badge/license-MIT-green)]() [![public repo](https://img.shields.io/badge/repo-public-brightgreen)]()

## Quick start

```bash
sg --help          # all commands
sg status          # or sg st
sg diff
sg commit          # interactive conventional commit + file picker (checkbox)
sg commit -m "feat(api): add login" --all
sg commit -m "fix(ui): tweak header" src/header.js   # commit specific file(s) only
sg commit src/foo.js src/bar.js                        # interactive with preselected files
sg commit -p -m "refactor: split parser" lib/parser.js # patch-stage specific files
sg log --limit 20 --search auth
sg branch --create my-feature    # prompts for feat/fix prefix
sg switch some-branch            # jump to existing branch (sg switch - = previous)
sg cleanup                      # delete merged branches + prune remotes
sg sync            # smart pull --rebase + push
sg sync --dry-run  # preview
sg undo            # safe undo last commit
sg cleanup --dry-run
sg stash           # interactive stash manager
```

## Commands

- `sg status` — enhanced status with sync suggestions
- `sg log` — graph log with `--search`, `--author`, `--oneline`
- `sg commit` — conventional commits (`feat`, `fix`, `docs`...), scope, breaking change, staging, **selective files** (`sg commit <file...>`, checkbox file picker, `-p/--patch` partial staging via `git add -p`)
- `sg branch` — `--create`, `--delete`, `--all`
- `sg switch` — jump between existing branches (`-` = previous), shows sync state
- `sg sync` — one-command sync (handles autostash, upstream, rebase)
- `sg undo` — `--soft`/`--hard`/`--commit <hash>` with confirm; **`sg undo <file...>` unstage or discard files (confirm-guarded)**
- `sg diff` — staged/unstaged stats + summary (no wall of text), `--patch` for full diff, `--staged`, `--check`, **`sg diff <ref> [ref2]` for branch/commit comparisons**
- `sg stash` — interactive, `--push`, `--pop`, `--clear`
- `sg cleanup` — prune merged branches + remotes

## Conventional commit format enforced

```
type(scope): subject

body

BREAKING CHANGE: ...

Closes #123
```

Types: `feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert`

## Development

```bash
git clone https://github.com/Danu28/smart-git.git
cd smart-git
npm install
node bin/smart-git.js --help
npm test            # 19 regression tests (node --test) — no-repo guards, selective commit,
                    # shell-injection safety, dry-run, undo-single-commit, spaces, stash, sync
# test inside a temp repo
mkdir /tmp/test-repo && cd /tmp/test-repo && git init && node /path/to/bin/smart-git.js status
```

> **Shell-safety:** all git subprocesses run through `spawnSync('git', argv)` (no shell string
> interpolation), so messages like `feat: "quotes" & $chars | ;` and filenames with spaces are
> always passed literally — on Windows and Unix.

## Philosophy

**Question:** repetitive git flags  
**Delete:** remove manual steps  
**Simplify:** one `sg sync` vs 4 git commands  
**Accelerate:** interactive prompts, safe defaults  
**Automate:** auto-stage, auto-stash, auto-prune

## License

MIT

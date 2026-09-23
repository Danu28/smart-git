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
| `git restore` pathspecs cryptic | `sg undo` is a `git restore` superset — `.`, `src/`, `*.js` pathspecs, `--source`/`--patch`, with confirm |
| Merged branches pile up | `sg cleanup` deletes merged branches + prunes remotes |
| `git diff` wall of text | `sg diff` staged vs unstaged stats + summary |
| `git stash` cryptic | `sg stash` interactive list/pop/apply/drop |

## Install — 1 command

### From npm (recommended)
```bash
npm install -g smart-git
# now use anywhere:
smart-git --help
sg --help
sg status
```

### From GitHub (fallback / pre-publish)
```bash
npm install -g github:Danu28/smart-git
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
npx smart-git --help
# or pre-publish:
npx github:Danu28/smart-git --help
```

> Requires `git` and `Node >=16`. Works on Windows/macOS/Linux.

[![npm version](https://img.shields.io/badge/version-2.0.0-blue)](https://www.npmjs.com/package/smart-git) [![ci](https://github.com/Danu28/smart-git/actions/workflows/ci.yml/badge.svg)](https://github.com/Danu28/smart-git/actions/workflows/ci.yml) [![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![node >=16](https://img.shields.io/badge/node-%3E%3D16-brightgreen)]()

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
sg continue        # after resolving conflicts: resume the in-progress rebase/merge
sg abort           # abandon the in-progress operation (confirm-guarded)
sg fixup <commit>  # fixup commit + autosquash into history
sg untrack .env     # stop tracking but keep on disk (offers .gitignore)
sg ignore "*.log"   # append .gitignore patterns — dedupe + tracked warnings
sg pr               # push branch + open PR via gh (compare URL without gh)
sg why src/foo.js:12 # who wrote that line (or whole file)
sg guide           # full playbook + per-command help in the terminal
sg rescue          # find ✖ LOST commits in the reflog (after reset --hard / branch -D)
sg doctor          # diagnose repo state (mid-rebase, detached HEAD, conflicts, gone upstream)
sg clean           # preview + safely delete untracked files (protects .env / keys)
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
- `sg undo` — `--soft`/`--hard`/`--commit <hash>` with confirm; **`sg undo <file|pathspec...>` unstage or discard files (confirm-guarded)**. A `git restore` superset: `sg undo .` restores everything changed, directory/glob pathspecs work (`src/`, `*.js`), `--staged`/`--worktree` target the index/worktree, `--source <ref>` pulls files from an older revision, `--patch` picks hunks interactively. Broad pathspecs never touch untracked files (same as `git restore`); an exact path still deletes one with confirm
- `sg rescue` — reflog recovery: lists commits with **✖ LOST** markers (reachable-checked), `sg rescue <hash>` creates a non-destructive `rescue/<hash>` branch
- `sg doctor` — state diagnosis: in-progress rebase/merge/cherry-pick ops with step counts, conflicted files, detached HEAD, gone upstream, stashes, shallow clone
- `sg clean` — guarded untracked deletion: preview by default, **protected-file guard** (.env, *.pem, *.key, id_rsa, ...) that requires `--force`
- `sg continue` — resume the in-progress rebase/merge/cherry-pick/revert; refuses while conflicts remain and lists them. `sg abort` — confirm-guarded rollback of the same
- `sg bisect` — binary search wizard: `sg bisect start [--bad HEAD --good <old> --test "npm test"]`, `sg bisect good|bad|skip`, `sg bisect run "cmd"`, `sg bisect log|visual|reset` (picker when active)
- `sg fixup <commit>` — `git commit --fixup` then a **non-interactive** `rebase -i --autosquash` (works with no upstream/root commits); `--no-rebase`, `--yes`, `--dry-run`
- `sg untrack <path...>` — `git rm --cached` keeping files on disk + .gitignore offer (the `.env` fix); `sg ignore [patterns...]` — append with dedupe, warns when a pattern still matches tracked files, `--from-status` checkbox picker
- `sg pr` — push (sets upstream) + `gh pr create --fill` (`--draft`/`--web`); auto-degrades to a GitHub compare URL when gh is missing; `SMART_GIT_GH` env override for gh shims/alternate installs
- `sg why <file>[:<line>]` — whole file → top authors + recent changes; a line → the exact commit + full `git log -L` history of that line
- `sg guide` — in-terminal playbook: golden path → recovery → housekeeping → team → safety contract; `sg guide <command>` shows one command's description + options (works outside a repo)
- `sg commit --amend` — now warns and asks for confirmation when the commit is already pushed
- `sg diff` — staged/unstaged stats + summary (no wall of text), `--patch` for full diff, `--staged`, `--check`, **`sg diff <ref> [ref2]` for branch/commit comparisons**
- `sg stash` — interactive, `--push`, `--pop`, `--clear`
- `sg checkpoint` / `sg save` / `sg chk` — 1-sec savepoints (named stashes): `sg checkpoint "try X"`, `sg checkpoint --list`, `--restore/--pop/--drop/--diff`, `--clear`, `-u` for untracked
- `sg review` — pre-push gate: secrets/protected files, WIP/TODO, conventional, large blobs >1MB, whitespace, conflict markers (`--staged/--all`, `--strict` for CI, `--fix` hints, `--json`)
- `sg tidy` — unified cleanup (replaces `cleanup`/`clean`): `--untracked` + `--merged`
- `sg cleanup` — *deprecated* → `sg tidy --merged` (still works, warns)
- `sg clean` — *deprecated* → `sg tidy --untracked` (still works, warns)

## Conventional commit format enforced

```
type(scope): subject

body

BREAKING CHANGE: ...

Closes #123
```

Types: `feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert`

## Playbook — getting the most out of sg

The same guide is in the terminal: **`sg guide`** (+ `sg guide <command>` for one command).

- **Daily golden path:** `sg status` → `sg diff` → `sg commit` → `sg sync`
- **Commit power moves:** `sg commit -m "fix(ui): x"` (auto-stages if nothing staged), `sg commit src/foo.js` (only that file), `sg commit -p` (patch-stage hunks), `--amend` warns when the commit is already pushed
- **When things go sideways:** `sg doctor` first (state + next command), `sg continue` / `sg abort` (mid-rebase/merge/cherry-pick), `sg undo` (`sg undo <file>` = unstage/discard a file, `sg undo .` = restore all, `sg undo <file> --source <ref>` = pull an older revision), `sg rescue` (recover lost commits), `sg fixup <sha>` (fix a past commit with autosquash)
- **Housekeeping:** `sg checkpoint "try X"` → `sg checkpoint --list` / `--restore`, `sg clean` (preview + protected-file guard), `sg untrack .env` (keep file, stop tracking), `sg ignore "*.log"` (dedupe + tracked warnings), `sg cleanup --dry-run`, `sg stash`
- **Team:** `sg pr` (push + `gh pr create --fill`, compare URL without gh), `sg why src/foo.js:12` (blame without the wall)
- **Safety contract:** destructive ops always confirm (`--yes`/`--force` to skip); every mutating command has `--dry-run`; nothing touches the remote except `sync`/`pr`; shell-safe argv everywhere

## Migration: `sg tidy` (replaces `sg clean` / `sg cleanup`)

`sg tidy` unifies the two housekeeping commands. Old names still work but print a deprecation warning.

| Before | After |
|---|---|
| `sg clean` / `sg clean --dry-run` | `sg tidy --untracked --dry-run` |
| `sg clean --force` | `sg tidy --untracked --force` |
| `sg cleanup` / `sg cleanup --dry-run` | `sg tidy --merged --dry-run` |
| `sg cleanup --yes` | `sg tidy --merged --yes` |
| `sg tidy --untracked --merged` | both in one run |

> Protected-file guard (`.env`, `*.pem`, `*.key`, `id_rsa` …) applies to `--untracked` only.

## Development

```bash
git clone https://github.com/Danu28/smart-git.git
cd smart-git
npm install
node bin/smart-git.js --help
npm test              # 111 tests (node --test) — tier-1/2/3 + guide + phase invariants
npm run test:coverage # c8 coverage (text + lcov)
npm run lint          # eslint . (Node >=16, CommonJS)
npm run lint:fix      # auto-fix
# test inside a temp repo
mkdir /tmp/test-repo && cd /tmp/test-repo && git init && node /path/to/bin/smart-git.js status
```

### Publishing to npm

```bash
npm version patch|minor|major  # bumps package.json + tags
npm publish --access public    # requires `npm login` + ownership of `smart-git`
```

> `smart-git` is not yet published — `npm view smart-git` currently 404s. Until `npm publish` succeeds, install via `github:Danu28/smart-git` as documented above. `package.json:files` is allowlisted to `bin/`, `src/`, `README.md`, `LICENSE`.

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

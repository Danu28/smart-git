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

## Install

```bash
npm install -g smart-git
# or local dev
npm install
npm link   # gives `smart-git` and `sg` commands
```

Requires `git` and `Node >=14`.

## Quick start

```bash
sg --help          # all commands
sg status          # or sg st
sg diff
sg commit          # interactive conventional commit
sg commit -m "feat(api): add login" --all
sg log --limit 20 --search auth
sg branch --create my-feature    # prompts for feat/fix prefix
sg branch --clean                # delete merged branches
sg sync            # smart pull --rebase + push
sg sync --dry-run  # preview
sg undo            # safe undo last commit
sg cleanup --dry-run
sg stash           # interactive stash manager
```

## Commands

- `sg status` — enhanced status with sync suggestions
- `sg log` — graph log with `--search`, `--author`, `--oneline`
- `sg commit` — conventional commits (`feat`, `fix`, `docs`...), scope, breaking change, staging
- `sg branch` — `--create`, `--delete`, `--clean`, `--all`
- `sg sync` — one-command sync (handles autostash, upstream, rebase)
- `sg undo` — `--soft`/`--hard`/`--commit <hash>` with confirm
- `sg diff` — staged/unstaged split, `--staged`, `--check`
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
git clone <repo>
npm install
node bin/smart-git.js --help
# test inside a temp repo
mkdir /tmp/test-repo && cd /tmp/test-repo && git init && node /path/to/bin/smart-git.js status
```

## Philosophy

**Question:** repetitive git flags  
**Delete:** remove manual steps  
**Simplify:** one `sg sync` vs 4 git commands  
**Accelerate:** interactive prompts, safe defaults  
**Automate:** auto-stage, auto-stash, auto-prune

## License

MIT

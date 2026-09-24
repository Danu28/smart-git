# Contributing to smart-git

Thanks for considering a contribution!

## Quick start

```bash
git clone https://github.com/Danu28/smart-git.git
cd smart-git
npm ci
npm test          # 111 tests (node --test)
npm run lint
npm run test:coverage
node bin/smart-git.js --help
```

## Branch naming

Use conventional prefixes (enforced by `sg branch --create`):

- `feat/<name>` — new feature
- `fix/<name>` — bug fix
- `docs/<name>` / `chore/<name>` / `refactor/<name>` etc.

## Commit messages

We enforce [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

body

BREAKING CHANGE: ...

Closes #123
```

Types: `feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert`

Use `sg commit` (interactive builder) to get this right automatically.

## Testing

- Tests use `node --test` (Node built-in, no Jest).
- Each test creates a temp repo via `fs.mkdtempSync` + `git init` — never touches your repo.
- Run coverage: `npm run test:coverage` (thresholds: lines 60%, branches 50%).

Add tests for any new command in `test/*.test.js`. Aim for ≥70% per-file for commands.

## Lint & format

```bash
npm run lint        # eslint .
npm run lint:fix    # auto-fix
npm run format      # prettier (if configured)
npm run format:check
```

Shell-safety rule: always use `spawnSync('git', argvArray)` — never interpolate user input into a shell string.

## Pull requests

1. Fork + branch from `main`.
2. Keep PRs focused (one feature per PR).
3. Ensure `npm test` + `npm run lint` pass in CI (Node 18/20/22, ubuntu/windows/macos).
4. Update `CHANGELOG.md` under `## Unreleased`.
5. Link issues (`Closes #123`).

## Safety contract

- Destructive ops must confirm (`--yes/--force` to skip).
- Every mutating command has `--dry-run`.
- Never touch remote except `sync`/`pr`.

## Questions?

Open an issue or run `sg guide` in the terminal.

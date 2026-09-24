# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- Coverage gates (`c8 --check-coverage --lines 60 --branches 50`) in `test:coverage` and CI.

## [2.0.0] - 2026-09-23

### Added
- `sg tidy` unified cleanup (`--untracked` + `--merged`) replacing `clean`/`cleanup` (deprecated but still works).
- `sg bisect` binary search wizard (`start`, `good/bad/skip`, `run`, `log`, `visual`, `reset`).
- `sg checkpoint` / `sg save` / `sg chk` named stash savepoints.
- `sg review` pre-push quality gate (secrets, large blobs, whitespace, WIP, conventional).
- `sg resolve` guided conflict resolution with checkpoint safety.
- `sg worktree`, `sg config`, `sg completion`, `sg init` commands.
- `src/triage.js` extraction for testable default triage (was inline in `bin/smart-git.js`).
- Modular `src/utils/git/*` split (run/status/pathspec).
- `src/commands/undo/handlers.js` extracted from monolithic `undo.js`.

### Changed
- `bin/smart-git.js` now delegates to `src/triage.js` (coverage 19% → testable).
- `engines` bumped to `Node >=18`.
- Lint hardening (eslint recommended + prettier), JSdoc types across utils.

### Fixed
- Shell-safety via `spawnSync('git', argv)` + `shellSplit` (no injection via `& $ "` etc.).
- `sg sync` re-reads `behind` after `fetch --prune` (stale upstream fix).
- Protected-file guard for `.env`, `*.pem`, `*.key`, `id_rsa` on `sg clean/tidy --untracked`.

## [1.6.1] - 2026-09-23

- Sync package-lock version.
- Remove unwanted files, keep repo clean.

## [1.0.0] - 2026-09-19

- Initial release: `status`, `log`, `commit`, `branch`, `switch`, `sync`, `undo`, `cleanup`, `diff`, `stash`, `rescue`, `doctor`, `clean`, `continue`, `abort`, `fixup`, `untrack`, `ignore`, `pr`, `why`, `guide`.

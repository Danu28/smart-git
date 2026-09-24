# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅ |
| <2.0    | ❌ |

## Reporting a Vulnerability

Do **not** open a public issue for security reports.

Email: **dhanushkanchan28@gmail.com** with subject `[SECURITY] smart-git`.

Include: affected version, reproduction steps, impact, and if possible a PoC repo.

We will acknowledge within 48h and aim to ship a fix within 7 days for critical issues.

## What we protect

- **Shell-safety:** all git subprocesses use `spawnSync('git', argv)` — no shell interpolation. Messages like `feat: "x" & $y | ;` and filenames with spaces are safe.
- **Protected files:** `.env`, `*.pem`, `*.key`, `id_rsa`, `credentials`, `secret` are never deleted by `sg clean/tidy --untracked` without `--force`.
- **Protected branches:** `main/master/develop/dev` are never deleted by `sg tidy --merged` / `cleanup`.
- **Destructive ops:** `sg undo --hard`, `sg clean`, `sg tidy` require confirm; `--dry-run` previews.

## Hardening tips

- Run `sg review` before push (secrets, large blobs, conflict markers).
- Use `sg untrack .env` to stop tracking without deleting on disk.
- Keep `sg` updated: `npm update -g smart-git`.

## Disclosure

We follow coordinated disclosure — we will credit reporters in `CHANGELOG.md` unless you prefer anonymity.

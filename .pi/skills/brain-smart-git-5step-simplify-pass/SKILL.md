---
name: brain-smart-git-5step-simplify-pass
description: Running an end-user 5-Step simplification pass on the smart-git CLI (or similar wrapper CLIs)
---

# smart-git-5step-simplify-pass

1. recall prior pass episode (e.g. recall{query:'smart-git sg 5-step ...'}) and replay the plan graph. 2. Read ALL src/commands/*.js + src/utils/*.js + README.md fresh — don't trust the prior state. 3. Grep for dead code: exported-but-never-imported helpers and declared-but-never-handled options (grep -rn '<name>' src/ test/). 4. Question every flag against its own .description text — a flag that doesn't change output is a no-op (delete or make it mean what it says). 5. Delete first (dead options, duplicate commands, unused exports), then Simplify (gate optional prompts behind one confirm to halve happy-path prompt count, keep answer-object shape identical so downstream stays untouched). 6. Re-verify with `npm test`, then CLI smoke in a temp repo (git init, commit, exercise each changed flag). 7. Interactive flows can't get a TTY on Windows — add a permanent regression test that stubs inquirer.prompt via the shared require cache and drives program.parseAsync(['commit'],{from:'user'}) with answer maps. 8. Bump patch version in package.json, keep the answers object shape (keys) unchanged across prompt reordering, commit with `npm test` green.

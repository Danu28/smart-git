## 1. TraceBlame: Paste-to-Culprit
**What it is:** Core command `smart-git trace --stacktrace <file>` that ingests a raw exception stacktrace, extracts every file:line, runs blame + SZZ algorithm to find the bug-introducing commit, not just the last touch. Ranks culprits by recency, author, and whether the line was added vs modified. Differentiator: goes beyond `git blame` by ignoring blame-noise and pinpointing origin commit.
**Why it helps this project:** For this brand-new empty project (no src/cli.ts or core engine exists yet), this directly solves the stated #1 pain: 'which commit broke this exception?' It defines the MVP wedge for smart-git and gives developers a 10-second answer instead of manual blame/log hunting.
**End-user usage flow:**
1. User runs `smart-git trace --stacktrace crash.log` or pipes `npm start 2>&1 | smart-git trace`
2. CLI parses stacktrace regex to extract file paths and line numbers, maps them to git-tracked files
3. For each location, runs `git blame` then walks history with `git log -S/-G` and SZZ to find the commit that first introduced the faulty code
4. Prints ranked table: commit hash, message, author, date, diff snippet, with `smart-git show <hash>` to inspect instantly

## 2. Bisect Buddy: Auto-Replay Bisect
**What it is:** Interactive `smart-git hunt --repro ./repro.sh` that automates `git bisect` without manual checkout. User provides a failing reproduction script (or exception signature), tool binary-searches history, auto-runs the script in a detached worktree, and pinpoints the first bad commit. Includes smart skip for unbuildable commits.
**Why it helps this project:** Targets the same exception-to-commit gap but for cases where stacktrace blame fails (logic bug, not line-specific). Since the project has no bisect automation module yet, this builds the second killer feature that makes smart-git 10x faster than manual `git bisect run`.
**End-user usage flow:**
1. User runs `smart-git hunt --repro 'pytest tests/test_checkout.py::test_crash' --good v1.2.0`
2. Tool creates isolated git worktrees for each bisect step to avoid dirty working directory
3. Auto-executes repro script, marks commit good/bad/skip, and handles build failures by auto-skipping
4. Outputs first bad commit with full diff and `smart-git hunt --replay` to re-run the failure on that commit

## 3. Semantic Blame Filter
**What it is:** AST-aware blame that ignores noise commits (formatting, renames, import sorting, lint fixes). `smart-git trace --semantic` parses the diff with tree-sitter to check if the AST node at the exception line actually changed logic. Filters out 70% of false-culprit commits that vanilla blame surfaces.
**Why it helps this project:** For an empty codebase with no diff-parsing logic yet, this is the key differentiator vs. existing `git blame`/`git log`. It solves the real developer frustration where `git blame` points to a Prettier commit instead of the logic change that caused the bug.
**End-user usage flow:**
1. After initial blame, tool fetches diff for each candidate commit via `git show`
2. Parses before/after file versions into AST and compares the node covering the exception line
3. Classifies commit as noise (whitespace/import/comment only) vs semantic (logic/control-flow change)
4. Re-ranks culprits to surface the last semantic change, showing filtered-out noise commits greyed out

## 4. Delta Detective: Exception-Aware Diff Search
**What it is:** `smart-git search --exception 'NullPointerException: userId'` that searches commit diffs and messages for code related to the exception, not just file names. Uses `git log --pickaxe` combined with exception keyword extraction and code-context embedding to find commits that touched error-adjacent code even if stacktrace line moved.
**Why it helps this project:** Addresses the gap where stacktraces are stale (refactored files, moved lines) and pure line-based blame fails. With no search/index module in this empty project, this creates a discovery path for production exceptions where the file:line no longer exists on main.
**End-user usage flow:**
1. User runs `smart-git search --exception 'TypeError: cannot read property map of undefined'`
2. Tool extracts keywords and stack frames, then runs `git log -G` and `git log --grep` across history
3. Scores commits by diff relevance, proximity to stacktrace files, and recency
4. Shows top 5 commits with highlighted diff hunks that match the exception context and `smart-git checkout --preview <hash>`

## 5. Fault Lens: Time-Travel Preview
**What it is:** `smart-git lens <commit>` spins up a temporary worktree at the culprit commit and shows a side-by-side of the exception line: before/after code, test status, and who reviewed it. One command to `code --diff` the change without polluting your current branch. Includes `smart-git lens --fix` to create a revert branch.
**Why it helps this project:** For a new CLI with no UX yet, this closes the loop from 'found the commit' to 'understood and fixed it'. It turns smart-git from a finder into a workflow tool, targeting the developer pain of context-switching and stashing changes just to inspect old code.
**End-user usage flow:**
1. After `trace` finds culprit abc1234, user runs `smart-git lens abc1234`
2. Tool creates ephemeral `git worktree` at abc1234 and opens diff view of the exact hunk that introduced the bug
3. Displays metadata: PR link, reviewer, CI status at that commit, and related issue tags
4. User can run `smart-git lens --revert` to auto-create a fix branch or `smart-git lens --exit` to clean up worktree

Top pick: TraceBlame: Paste-to-Culprit

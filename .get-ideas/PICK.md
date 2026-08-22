# Final Pick — Product Owner Recommendation

**Thinking: low | Lane: S**

## Requirements (first-pass -> first-principles review)

1. Read `.get-ideas/latest.md` and understand all 5 candidates — *Source: task brief. Keep: yes, mandatory input.*
2. Select exactly 1 final best idea — *Source: task brief. Keep: yes, core deliverable.*
3. Explain WHY it is best — *Source: task brief. Keep: yes, justification required.*
4. Act as Product Owner (value, feasibility, differentiation) — *Source: persona. Keep: yes.*
5. Keep output concise and actionable — *Source: harness discipline. Keep: yes.*

**First-principles filter:**
- Questioned: Is a 5-way ranked teardown needed? No — 1 pick + why suffices. Deleted full teardown.
- Questioned: New framework to decide? No — PO judgment on pain x feasibility x moat is enough.
- Simplified: One file (PICK.md), one winner, 3 reasons, 1 next step.
- Accelerate/Automate: Nothing to automate; judgment call.

## Pick: #1 TraceBlame: Paste-to-Culprit — `smart-git trace --stacktrace`

> Doc already flags this as "Top pick" — concur as PO. It is the right wedge.

### Why this wins

**1. Biggest pain x widest audience, lowest friction.**
Every dev asks "which commit broke this stacktrace?" weekly. Flow: paste stacktrace -> ranked culprits in 10s. No repro script needed (vs #2 Bisect Buddy), no AST parser (#3), no stale-line search (#4), no prior culprit needed (#5). Input is what user already has (crash.log / piped stderr).

**2. Fastest MVP that creates the platform for the rest.**
Project is empty (no src/cli.ts). #1 needs only git blame + git log -S/-G + SZZ — stdlib git. Ships in days, demos in one gif. #3 is a flag on top of trace (--semantic), #5 (lens) needs a culprit hash from trace. Build #1 first; others become cheap upsells. Building #2/#4/#5 first leaves you without the core finder.

**3. Clearest moat vs `git blame`.**
Plain blame points to last touch — often Prettier/rename. TraceBlame's SZZ + ranking (added vs modified, recency) finds the *origin* commit. Explainable, defensible, 10x faster than manual blame/log. #3 is an enhancement to #1, not standalone. #4 (embedding) is fuzzier. #2 automates `git bisect run` which already exists.

### Why not the others

- **#2 Bisect Buddy:** Great for logic bugs but needs deterministic repro — high friction, narrower audience. Build second.
- **#3 Semantic Blame Filter:** Best *second* feature — add as `trace --semantic` after #1. No value standalone.
- **#4 Delta Detective:** Useful for stale/moved lines but lower precision, needs tuning. Good third feature.
- **#5 Fault Lens:** Polish (view/fix without stashing) — zero value until #1 finds commit.

### Next step

Ship `smart-git trace --stacktrace <file|stdin>` -> regex extract file:line -> blame -> SZZ origin -> ranked table (hash, message, author, date, snippet). Then add #3 and #5 on same output.

---
Skipped: full scoring matrix, tech spec, roadmap — add when stakeholders ask.

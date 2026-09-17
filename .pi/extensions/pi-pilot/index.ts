// @ts-nocheck
/**
 * pi-pilot — structured pi extension fixing batching + workflow
 *
 * Gaps solved:
 *  1. edit/read/write/bash N:1 batching + whitespace -> smart_edit/smart_read/smart_write/smart_bash (8 per 1 LLM call, fuzzy, queue-safe)
 *  2. bash without timeout     -> tool_call gate (mandatory timeout inject)
 *  3. no structured thinking   -> pilot_think (PFC debate scored)
 *  4. no planning DAG          -> pilot_plan (tasklist with depends + persistence)
 *  5. inefficient gathering    -> pilot_gather (batched grep+read) — step 1 of gather->think->plan->execute->done->commit
 *
 * Load once: pi -e ./.pi/extensions/pi-pilot/index.ts
 * Or auto-discovered via .pi/extensions/pi-pilot/ (copy here lives)
 * pi 0.85.x · erasable TS · tabs · no any
 */

import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	type ExtensionAPI,
	formatSize,
	isToolCallEventType,
	keyHint,
	truncateHead,
	truncateTail,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Static, Type } from "typebox";

// ---------------------------------------------------------------------------
// Shared state — rebuilt on session_start (session-correct)
// ---------------------------------------------------------------------------

interface PilotState {
	bashInjected: number;
	smartEdits: number;
	smartReads: number;
	smartWrites: number;
	smartBashes: number;
	thinks: number;
	plans: number;
	gathers: number;
}

const state: PilotState = {
	bashInjected: 0,
	smartEdits: 0,
	smartReads: 0,
	smartWrites: 0,
	smartBashes: 0,
	thinks: 0,
	plans: 0,
	gathers: 0,
};

interface PlanEntry {
	goal: string;
	tasks: string[];
	done: boolean[];
	createdAt: number;
}

let currentPlan: PlanEntry | null = null;

function describePilot(): string {
	const plan = currentPlan ? ` plan:${currentPlan.tasks.length}(${currentPlan.done.filter(Boolean).length}✓)` : "";
	return `pi-pilot bash:${state.bashInjected} edit:${state.smartEdits} read:${state.smartReads} write:${state.smartWrites} sbash:${state.smartBashes} think:${state.thinks}${plan} gather:${state.gathers}`;
}

// ---------------------------------------------------------------------------
// Helpers: fuzzy matching for smart_edit
// ---------------------------------------------------------------------------

function normalizeLine(line: string): string {
	return line.replace(/\s+$/u, "");
}

function findFuzzyIndex(haystack: string, needle: string): number {
	if (haystack.includes(needle)) return haystack.indexOf(needle);
	// line-trimmed fuzzy search
	const hayLines = haystack.split("\n");
	const needleLines = needle.split("\n");
	const trimmedNeedle = needleLines.map(normalizeLine);
	// remove trailing empty needle lines for matching tolerance
	while (trimmedNeedle.length > 0 && trimmedNeedle[trimmedNeedle.length - 1] === "") trimmedNeedle.pop();
	if (trimmedNeedle.length === 0) return -1;
	for (let i = 0; i <= hayLines.length - trimmedNeedle.length; i++) {
		let ok = true;
		for (let j = 0; j < trimmedNeedle.length; j++) {
			if (normalizeLine(hayLines[i + j]) !== trimmedNeedle[j]) {
				ok = false;
				break;
			}
		}
		if (ok) {
			const before = hayLines.slice(0, i).join("\n");
			return before.length === 0 ? 0 : before.length + 1;
		}
	}
	// whitespace-collapsed fallback (single-line needles)
	const collapsedNeedle = needle.trim().replace(/\s+/gu, " ");
	if (collapsedNeedle.length >= 8) {
		const collapsedHay = haystack.replace(/\s+/gu, " ");
		const idx = collapsedHay.indexOf(collapsedNeedle);
		if (idx !== -1) {
			// approximate — fall back to exact not-found handling by caller
			return -2;
		}
	}
	return -1;
}

function applyEdits(content: string, edits: Array<{ oldText: string; newText: string }>): string {
	let next = content;
	for (const edit of edits) {
		if (edit.oldText === "") {
			// insert at end
			next += (next.endsWith("\n") || next === "" ? "" : "\n") + edit.newText;
			continue;
		}
		let idx = next.indexOf(edit.oldText);
		if (idx === -1) {
			idx = findFuzzyIndex(next, edit.oldText);
			if (idx === -1) {
				throw new Error(
					`smart_edit: oldText not found (even fuzzy). Tried exact and line-trimmed match for:\n---\n${edit.oldText.slice(0, 500)}\n---\nHint: copy the exact block via read, or use a shorter unique anchor (3-6 lines).`,
				);
			}
			if (idx === -2) {
				throw new Error(
					`smart_edit: oldText not found exactly but whitespace-collapsed match exists. Re-read the file and use exact indentation for:\n${edit.oldText.slice(0, 300)}`,
				);
			}
			// idx from line-trimmed search points to line start; slice exact needle length from original
			// instead find the real needle span by extracting that line range
			const lines = next.split("\n");
			const needleLines = edit.oldText.split("\n");
			const needleTrimLen = needleLines.map(normalizeLine).filter((l) => l !== "" || needleLines.length === 1).length;
			// locate start line
			let startLine = -1;
			const trimmedNeedle = needleLines.map(normalizeLine);
			while (trimmedNeedle.length > 0 && trimmedNeedle[trimmedNeedle.length - 1] === "") trimmedNeedle.pop();
			for (let i = 0; i <= lines.length - trimmedNeedle.length; i++) {
				let ok = true;
				for (let j = 0; j < trimmedNeedle.length; j++) if (normalizeLine(lines[i + j]) !== trimmedNeedle[j]) { ok = false; break; }
				if (ok) { startLine = i; break; }
			}
			if (startLine === -1) throw new Error("smart_edit: fuzzy locate failed unexpectedly");
			let endLine = startLine + trimmedNeedle.length;
			const before = lines.slice(0, startLine).join("\n");
			const after = lines.slice(endLine).join("\n");
			const prefix = before.length === 0 ? "" : before + "\n";
			const suffix = after.length === 0 ? "" : "\n" + after;
			next = prefix + edit.newText + suffix;
			continue;
		}
		next = next.slice(0, idx) + edit.newText + next.slice(idx + edit.oldText.length);
	}
	return next;
}

// ---------------------------------------------------------------------------
// Tool params
// ---------------------------------------------------------------------------

const smartEditParams = Type.Object({
	path: Type.String({ description: "File to edit, relative to cwd" }),
	edits: Type.Array(
		Type.Object({
			oldText: Type.String({ description: "Exact text to replace; empty string = append" }),
			newText: Type.String({ description: "Replacement text" }),
		}),
		{ description: "One or more non-overlapping replacements (matched against original file)" },
	),
	createIfMissing: Type.Optional(Type.Boolean({ description: "Create file if missing (default true)" })),
});

export type SmartEditInput = Static<typeof smartEditParams>;

const thinkParams = Type.Object({
	goal: Type.String({ description: "Question or decision to deliberate" }),
	hypotheses: Type.Array(Type.String(), {
		description: "2-3 hypotheses. Format: 'Title | cost:1-10 risk:1-10 rev:1-10 | argues...' or plain text",
		minItems: 2,
		maxItems: 3,
	}),
});

export type ThinkInput = Static<typeof thinkParams>;

const planParams = Type.Object({
	action: StringEnum(["create", "add", "done", "list"] as const, { description: "Plan action" }),
	goal: Type.Optional(Type.String({ description: "Plan goal (for create)" })),
	tasks: Type.Optional(Type.Array(Type.String(), { description: "Tasks for create/add (format: 'title | depends:0,1 estimate:15m')" })),
	indices: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }), { description: "Task indices for done" })),
});

export type PlanInput = Static<typeof planParams>;

const gatherParams = Type.Object({
	query: Type.String({ description: "Search term / grep pattern" }),
	mode: Type.Optional(StringEnum(["grep", "read", "auto"] as const, { description: "Gather mode (default auto = grep+read)" })),
	files: Type.Optional(Type.Array(Type.String(), { description: "Extra files to read verbatim (parallel)" })),
	maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Max grep hits (default 30)" })),
});

export type GatherInput = Static<typeof gatherParams>;

const smartReadParams = Type.Object({
	files: Type.Array(Type.String({ description: "File path relative to cwd" }), { minItems: 1, maxItems: 8, description: "Up to 8 files per 1 LLM call — batch reads" }),
});

export type SmartReadInput = Static<typeof smartReadParams>;

const smartWriteParams = Type.Object({
	writes: Type.Array(
		Type.Object({
			path: Type.String({ description: "File path relative to cwd" }),
			content: Type.String({ description: "Full file content to write" }),
		}),
		{ minItems: 1, maxItems: 8, description: "Up to 8 files per 1 LLM call — batch writes" },
	),
});

export type SmartWriteInput = Static<typeof smartWriteParams>;

const smartBashParams = Type.Object({
	commands: Type.Array(
		Type.Object({
			command: Type.String({ description: "Bash command to run" }),
			timeout: Type.Optional(Type.Integer({ minimum: 2000, maximum: 120000, description: "Per-command timeout ms (default 15000, capped 120000)" })),
		}),
		{ minItems: 1, maxItems: 8, description: "Up to 8 commands per 1 LLM call — sequential batch" },
	),
	parallel: Type.Optional(Type.Boolean({ description: "Run commands in parallel (default false = sequential)" })),
});

export type SmartBashInput = Static<typeof smartBashParams>;



// ---------------------------------------------------------------------------
// Main extension
// ---------------------------------------------------------------------------

export default function piPilot(pi: ExtensionAPI): void {
	// capture pi for closures (appendEntry, exec, getAllTools)
	const piRef = pi;

	// ---- smart_edit
	const smartEditTool = defineTool({
		name: "smart_edit",
		label: "Smart Edit",
		description: "ALWAYS use instead of edit: whitespace-tolerant (fuzzy line-trim fallback), queue-safe, 50KB/2000 lines truncated. Saves retries.",
		promptSnippet: "ALWAYS use smart_edit instead of edit — whitespace-tolerant",
		promptGuidelines: [
			"ALWAYS use smart_edit instead of edit — even for single edits, it handles whitespace mismatch via fuzzy trim match and is file-queue safe.",
			"Agent auto-picks smart_edit for any file edit without user asking; batch multiple edits in one call.",
			"Workflow step 4: auto-use during execute phase of pilot_gather -> pilot_think -> pilot_plan -> execute (smart_edit/smart_bash) -> pilot_plan done -> commit.",
		],
		parameters: smartEditParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const target = resolve(ctx.cwd, params.path);
			return withFileMutationQueue(target, async () => {
				await mkdir(dirname(target), { recursive: true });
				let current = "";
				try {
					current = await readFile(target, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT" || params.createIfMissing === false) throw error;
					current = "";
				}
				const next = applyEdits(current, params.edits);
				await writeFile(target, next, "utf8");
				state.smartEdits += 1;
				piRef.appendEntry("pi-pilot:smart_edit", { path: params.path, edits: params.edits.length, at: Date.now() });
				if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
				const summary = `smart_edit ${params.path}: ${params.edits.length} edit(s) applied (${current.length} -> ${next.length} bytes)`;
				const truncation = truncateHead(summary, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
				const text = truncation.truncated ? `${truncation.content}\n[truncated ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]` : truncation.content;
				return {
					content: [{ type: "text", text }],
					details: { path: params.path, applied: params.edits.length, bytesBefore: current.length, bytesAfter: next.length },
				};
			});
		},
		renderCall(args, theme) {
			let t = theme.fg("toolTitle", theme.bold("smart_edit ")) + theme.fg("muted", args.path);
			t += theme.fg("dim", ` ×${args.edits.length}`);
			return new Text(t, 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { path?: string; applied?: number } | undefined;
			if (!d?.path) return new Text(theme.fg("dim", "smart_edit"), 0, 0);
			let text = `${theme.fg("success", "✓")} ${theme.fg("accent", d.path)} ${theme.fg("dim", `${d.applied ?? 0} edit(s)`)}`;
			if (!opts.expanded) text += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			return new Text(text, 0, 0);
		},
	});

	// ---- pilot_think
	const thinkTool = defineTool({
		name: "pilot_think",
		label: "Pilot Think",
		description: "ALWAYS use before planning: structured PFC debate scoring 2-3 hypotheses on cost/risk/rev/relevance. Auto-pick without user asking.",
		promptSnippet: "ALWAYS run pilot_think before pilot_plan — structured debate",
		promptGuidelines: [
			"ALWAYS auto-run pilot_think after pilot_gather and before pilot_plan — no user ask needed. Workflow: pilot_gather -> pilot_think -> pilot_plan -> execute -> done -> commit.",
			"Auto-pick when approach unclear/risky or after 2 tool failures: think{goal:'debug <task>', hypotheses:[cause,fix]} — scores and pins winner.",
		],
		parameters: thinkParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const parsed = params.hypotheses.map((raw) => {
				const parts = raw.split("|").map((s) => s.trim());
				let title = parts[0] ?? raw;
				let cost = 5;
				let risk = 5;
				let rev = 5;
				let argues = parts.length > 1 ? parts.slice(1).join(" | ") : raw;
				// try to extract cost/risk/rev from any part
				for (const p of parts) {
					const c = p.match(/cost\s*[:=]\s*(\d+)/i);
					const r = p.match(/risk\s*[:=]\s*(\d+)/i);
					const v = p.match(/rev(?:ersibility)?\s*[:=]\s*(\d+)/i);
					if (c) cost = Math.max(1, Math.min(10, Number(c[1])));
					if (r) risk = Math.max(1, Math.min(10, Number(r[1])));
					if (v) rev = Math.max(1, Math.min(10, Number(v[1])));
				}
				// relevance heuristic: keyword overlap with goal
				const goalWords = new Set(params.goal.toLowerCase().split(/\W+/u).filter(Boolean));
				const hypWords = title.toLowerCase().split(/\W+/u).filter(Boolean);
				let relevance = 5;
				if (goalWords.size > 0) {
					const overlap = hypWords.filter((w) => goalWords.has(w)).length;
					relevance = Math.min(10, 5 + overlap * 1.5);
				}
				// if scores not provided, infer from length/specificity
				const hasExplicit = parts.some((p) => /cost|risk|rev/i.test(p));
				if (!hasExplicit) {
					// longer, more specific hypotheses slightly higher cost but higher relevance
					cost = Math.min(10, Math.max(2, Math.round(raw.length / 80) + 3));
					rev = raw.includes("reversible") || raw.includes("rollback") ? 8 : 6;
				}
				const score = (10 - cost) * 0.25 + (10 - risk) * 0.3 + rev * 0.2 + relevance * 0.25;
				return { title, argues, cost, risk, rev, relevance, score };
			});
			let winner = 0;
			for (let i = 1; i < parsed.length; i++) if (parsed[i].score > parsed[winner].score) winner = i;
			state.thinks += 1;
			piRef.appendEntry("pi-pilot:think", { goal: params.goal, hypotheses: params.hypotheses, winner, at: Date.now() });
			if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
			const lines: string[] = [];
			lines.push(`goal: ${params.goal}`);
			for (let i = 0; i < parsed.length; i++) {
				const h = parsed[i];
				const mark = i === winner ? "★ winner" : "  ";
				lines.push(`${mark} [${i}] ${h.title} | cost:${h.cost} risk:${h.risk} rev:${h.rev} rel:${h.relevance.toFixed(1)} score:${h.score.toFixed(1)} | ${h.argues.slice(0, 120)}`);
			}
			lines.push(`conclusion: hypothesis ${winner} pinned`);
			const out = lines.join("\n");
			const trunc = truncateHead(out, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			const text = trunc.truncated ? `${trunc.content}\n[truncated]` : trunc.content;
			return {
				content: [{ type: "text", text }],
				details: { goal: params.goal, hypotheses: parsed, winner },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("pilot_think ")) + theme.fg("muted", args.goal.slice(0, 60)), 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { winner?: number; hypotheses?: Array<{ title: string; score: number }> } | undefined;
			if (!d?.hypotheses) return new Text(theme.fg("dim", "pilot_think"), 0, 0);
			let t = `${theme.fg("success", "✓")} ${theme.fg("accent", `winner: ${d.hypotheses[d.winner ?? 0]?.title ?? ""}`)}`;
			if (opts.expanded) {
				for (let i = 0; i < d.hypotheses.length; i++) {
					const h = d.hypotheses[i];
					const star = i === d.winner ? theme.fg("success", "★") : theme.fg("dim", " ");
					t += `\n ${star} [${i}] ${theme.fg("muted", h.title)} ${theme.fg("dim", `score ${h.score.toFixed(1)}`)}`;
				}
			} else t += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			return new Text(t, 0, 0);
		},
	});

	// ---- pilot_plan
	const planTool = defineTool({
		name: "pilot_plan",
		label: "Pilot Plan",
		description: "ALWAYS use after pilot_think: DAG planner (create/add/done/list, 3-10 tasks, depends:0,1). Auto-pick without user asking.",
		promptSnippet: "ALWAYS create pilot_plan after pilot_think — DAG with depends",
		promptGuidelines: [
			"ALWAYS auto-create pilot_plan after pilot_think — no user ask needed. Workflow steps 3/5: pilot_gather -> pilot_think -> pilot_plan (create) -> execute -> pilot_plan done -> commit.",
			"Auto-track progress: execute with smart_edit/smart_bash/smart_read/smart_write, then pilot_plan done [indices] and list; commit when all done.",
		],
		parameters: planParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// reconstruct helper inline for branch safety
			const rebuild = (): void => {
				// prefer in-memory if fresh; otherwise scan branch
				if (currentPlan) return;
			};
			rebuild();
			switch (params.action) {
				case "create": {
					if (!params.goal || !params.tasks || params.tasks.length === 0) throw new Error("pilot_plan create requires goal and tasks[3-10]");
					if (params.tasks.length < 3 || params.tasks.length > 10) throw new Error("pilot_plan: tasks length must be 3-10");
					currentPlan = { goal: params.goal, tasks: [...params.tasks], done: params.tasks.map(() => false), createdAt: Date.now() };
					state.plans += 1;
					piRef.appendEntry("pi-pilot:plan", { action: "create", goal: params.goal, tasks: params.tasks, at: Date.now() });
					if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
					return {
						content: [{ type: "text", text: `plan created: ${params.goal}\n${params.tasks.map((t, i) => ` [ ] ${i}. ${t}`).join("\n")}` }],
						details: { action: "create", plan: currentPlan },
					};
				}
				case "add": {
					if (!currentPlan) throw new Error("pilot_plan add: no current plan, create first");
					if (!params.tasks || params.tasks.length === 0) throw new Error("pilot_plan add requires tasks");
					currentPlan.tasks.push(...params.tasks);
					currentPlan.done.push(...params.tasks.map(() => false));
					piRef.appendEntry("pi-pilot:plan", { action: "add", tasks: params.tasks, at: Date.now() });
					if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
					return {
						content: [{ type: "text", text: `added ${params.tasks.length} tasks\n${currentPlan.tasks.map((t, i) => ` [${currentPlan!.done[i] ? "x" : " "}] ${i}. ${t}`).join("\n")}` }],
						details: { action: "add", plan: currentPlan },
					};
				}
				case "done": {
					if (!currentPlan) throw new Error("pilot_plan done: no current plan");
					if (!params.indices || params.indices.length === 0) throw new Error("pilot_plan done requires indices");
					for (const idx of params.indices) {
						if (idx < 0 || idx >= currentPlan.tasks.length) throw new Error(`index ${idx} out of range`);
						// depends check: parse depends:0,1
						const m = currentPlan.tasks[idx].match(/depends\s*:\s*([0-9,\s]+)/i);
						if (m) {
							const deps = m[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
							const blocked = deps.filter((d) => !currentPlan!.done[d]);
							if (blocked.length > 0) throw new Error(`task ${idx} blocked by unfinished depends: ${blocked.join(",")}`);
						}
						currentPlan.done[idx] = true;
					}
					piRef.appendEntry("pi-pilot:plan", { action: "done", indices: params.indices, at: Date.now() });
					if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
					const allDone = currentPlan.done.every(Boolean);
					return {
						content: [{ type: "text", text: `marked done: ${params.indices.join(",")} ${allDone ? "\nAll tasks done ✓" : ""}\n${currentPlan.tasks.map((t, i) => ` [${currentPlan!.done[i] ? "x" : " "}] ${i}. ${t}`).join("\n")}` }],
						details: { action: "done", plan: currentPlan, allDone },
					};
				}
				case "list": {
					if (!currentPlan) return { content: [{ type: "text", text: "no active plan" }], details: { action: "list", plan: null } };
					return {
						content: [{ type: "text", text: `${currentPlan.goal}\n${currentPlan.tasks.map((t, i) => ` [${currentPlan.done[i] ? "x" : " "}] ${i}. ${t}`).join("\n")}` }],
						details: { action: "list", plan: currentPlan },
					};
				}
				default:
					throw new Error(`unknown action ${params.action}`);
			}
		},
		renderCall(args, theme) {
			let t = theme.fg("toolTitle", theme.bold("pilot_plan ")) + theme.fg("muted", args.action);
			if (args.goal) t += theme.fg("dim", ` ${args.goal.slice(0, 40)}`);
			return new Text(t, 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { action?: string; plan?: PlanEntry | null; allDone?: boolean } | undefined;
			if (!d?.plan) return new Text(theme.fg("dim", "no plan"), 0, 0);
			const doneCount = d.plan.done.filter(Boolean).length;
			let t = `${theme.fg("success", "✓")} ${theme.fg("accent", d.plan.goal.slice(0, 50))} ${theme.fg("muted", `${doneCount}/${d.plan.tasks.length}`)}`;
			if (opts.expanded || d.allDone) t += `\n${d.plan.tasks.map((task, i) => ` ${d.plan.done[i] ? theme.fg("success", "✓") : theme.fg("dim", "○")} ${i}. ${theme.fg("text", task)}`).join("\n")}`;
			else t += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			return new Text(t, 0, 0);
		},
	});

	// ---- pilot_gather
	const gatherTool = defineTool({
		name: "pilot_gather",
		label: "Pilot Gather",
		description: "ALWAYS use first on any task: batched grep+read in one call (50KB/2000 lines). Auto-pick without user asking.",
		promptSnippet: "ALWAYS start with pilot_gather — batched grep+read",
		promptGuidelines: [
			"ALWAYS auto-start with pilot_gather without user asking — step 1 of pilot_gather -> pilot_think -> pilot_plan -> execute -> done -> commit.",
			"Auto-pick instead of sequential grep/read; batches ripgrep + up to 8 file reads in one turn and truncates.",
		],
		parameters: gatherParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const mode = params.mode ?? "auto";
			const maxResults = params.maxResults ?? 30;
			const chunks: string[] = [];
			// grep via rg
			if (mode === "grep" || mode === "auto") {
				try {
					// escape pattern for shell: use pi.exec with args
					const pattern = params.query;
					const result = await piRef.exec("rg", ["--line-number", "--no-heading", "--max-count", String(maxResults), "--hidden", "--glob", "!.git", pattern, "."], {
						signal: signal ?? undefined,
						timeout: 15000,
					});
					const out = (result.stdout ?? "").trim();
					if (out) {
						const trunc = truncateHead(out, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
						chunks.push(`# grep "${pattern}" (${trunc.truncated ? "truncated " : ""}${trunc.outputLines}/${trunc.totalLines} lines)\n${trunc.content}${trunc.truncated ? `\n[truncated ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}]` : ""}`);
					} else {
						chunks.push(`# grep "${pattern}": no matches`);
					}
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					chunks.push(`# grep failed: ${msg.slice(0, 500)}`);
				}
			}
			// parallel reads
			if ((mode === "read" || mode === "auto") && params.files && params.files.length > 0) {
				const reads = await Promise.all(
					params.files.slice(0, 8).map(async (file) => {
						const abs = resolve(ctx.cwd, file);
						try {
							const content = await readFile(abs, "utf8");
							const trunc = truncateTail(content, { maxLines: 120, maxBytes: 20000 });
							return `## ${file} (${trunc.truncated ? "tail " : ""}${trunc.outputLines} lines)\n${trunc.content}${trunc.truncated ? `\n[capped ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}]` : ""}`;
						} catch (error) {
							return `## ${file}: ${(error as Error).message.slice(0, 300)}`;
						}
					}),
				);
				chunks.push(...reads);
			}
			if (chunks.length === 0) chunks.push("pilot_gather: nothing to gather (provide query or files)");
			state.gathers += 1;
			piRef.appendEntry("pi-pilot:gather", { query: params.query, mode, at: Date.now() });
			if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
			const combined = chunks.join("\n\n---\n\n");
			const trunc = truncateHead(combined, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			const text = trunc.truncated ? `${trunc.content}\n\n[Output truncated ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)} — rerun with narrower query/files]` : trunc.content;
			return {
				content: [{ type: "text", text }],
				details: { query: params.query, mode, chunks: chunks.length },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("pilot_gather ")) + theme.fg("muted", `"${args.query}"`) + theme.fg("dim", ` ${args.mode ?? "auto"}`), 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { query?: string; chunks?: number } | undefined;
			let t = `${theme.fg("success", "✓")} ${theme.fg("accent", d?.query ?? "")} ${theme.fg("dim", `${d?.chunks ?? 0} chunk(s)`)}`;
			if (!opts.expanded) t += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			else {
				const content = result.content[0];
				const txt = content?.type === "text" ? content.text.slice(0, 600) : "";
				t += `\n${theme.fg("muted", txt)}`;
			}
			return new Text(t, 0, 0);
		},
	});

	// ---- smart_read (batched, 8 files per 1 LLM call)
	const smartReadTool = defineTool({
		name: "smart_read",
		label: "Smart Read",
		description: "ALWAYS use instead of read: batched up to 8 files per 1 LLM call, 200 lines/30KB per file truncated. Saves N LLM calls.",
		promptSnippet: "ALWAYS use smart_read instead of read — 8 files per 1 call",
		promptGuidelines: [
			"ALWAYS use smart_read instead of read — even for 1 file — batch up to 8 files per 1 LLM call to save calls.",
			"Agent auto-picks smart_read for any read without user asking; pairs with smart_write/smart_bash/smart_edit for N:1 batching.",
		],
		parameters: smartReadParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const reads = await Promise.all(
				params.files.slice(0, 8).map(async (file) => {
					const abs = resolve(ctx.cwd, file);
					try {
						const content = await readFile(abs, "utf8");
						const trunc = truncateTail(content, { maxLines: 200, maxBytes: 30000 });
						return `## ${file} (${trunc.truncated ? "tail " : ""}${trunc.outputLines}/${trunc.totalLines} lines ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)})\n${trunc.content}${trunc.truncated ? `\n[capped ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}]` : ""}`;
					} catch (error) {
						return `## ${file}: ${(error as Error).message.slice(0, 500)}`;
					}
				}),
			);
			state.smartReads += 1;
			piRef.appendEntry("pi-pilot:smart_read", { files: params.files, at: Date.now() });
			if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
			const combined = reads.join("\n\n---\n\n");
			const trunc = truncateHead(combined, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			const text = trunc.truncated ? `${trunc.content}\n\n[Output truncated ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)} — rerun with fewer files]` : trunc.content;
			return {
				content: [{ type: "text", text }],
				details: { files: params.files, count: params.files.length },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("smart_read ")) + theme.fg("muted", `${args.files.length} file(s)`), 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { files?: string[]; count?: number } | undefined;
			let t = `${theme.fg("success", "✓")} ${theme.fg("accent", `${d?.count ?? 0} file(s)`)}`;
			if (!opts.expanded) t += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			else t += `\n${(d?.files ?? []).map((f) => ` ${theme.fg("muted", f)}`).join("\n")}`;
			return new Text(t, 0, 0);
		},
	});

	// ---- smart_write (batched, 8 files per 1 LLM call)
	const smartWriteTool = defineTool({
		name: "smart_write",
		label: "Smart Write",
		description: "ALWAYS use instead of write: batched up to 8 files per 1 LLM call, creates dirs, queue-safe. Saves N LLM calls.",
		promptSnippet: "ALWAYS use smart_write instead of write — 8 files per 1 call",
		promptGuidelines: [
			"ALWAYS use smart_write instead of write — batch up to 8 files per 1 LLM call to save calls; each write is queue-safe.",
			"Agent auto-picks smart_write for any write without user asking; use during execute phase.",
		],
		parameters: smartWriteParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const results: string[] = [];
			for (const w of params.writes.slice(0, 8)) {
				const target = resolve(ctx.cwd, w.path);
				await withFileMutationQueue(target, async () => {
					await mkdir(dirname(target), { recursive: true });
					await writeFile(target, w.content, "utf8");
				});
				results.push(`${w.path}: ${w.content.length} bytes`);
			}
			state.smartWrites += 1;
			piRef.appendEntry("pi-pilot:smart_write", { writes: params.writes.map((w) => w.path), at: Date.now() });
			if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
			const summary = `smart_write ${params.writes.length} file(s): ${results.join(", ")}`;
			const trunc = truncateHead(summary, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			const text = trunc.truncated ? `${trunc.content}\n[truncated ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}]` : trunc.content;
			return {
				content: [{ type: "text", text }],
				details: { writes: params.writes.map((w) => w.path), count: params.writes.length },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("smart_write ")) + theme.fg("muted", `${args.writes.length} file(s)`), 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { writes?: string[]; count?: number } | undefined;
			let t = `${theme.fg("success", "✓")} ${theme.fg("accent", `${d?.count ?? 0} file(s)`)}`;
			if (!opts.expanded) t += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			else t += `\n${(d?.writes ?? []).map((f) => ` ${theme.fg("muted", f)}`).join("\n")}`;
			return new Text(t, 0, 0);
		},
	});

	// ---- smart_bash (batched, 8 commands per 1 LLM call)
	const smartBashTool = defineTool({
		name: "smart_bash",
		label: "Smart Bash",
		description: "ALWAYS use instead of bash: batched up to 8 commands per 1 LLM call, 2-120s timeout each. Saves N LLM calls.",
		promptSnippet: "ALWAYS use smart_bash instead of bash — 8 cmds per 1 call",
		promptGuidelines: [
			"ALWAYS use smart_bash instead of bash — batch up to 8 commands per 1 LLM call to save calls; enforces 2-120s timeout.",
			"Agent auto-picks smart_bash for any bash without user asking; sequential by default, parallel:true for independent cmds.",
		],
		parameters: smartBashParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const runOne = async (cmd: { command: string; timeout?: number }) => {
				const timeout = Math.min(120000, Math.max(2000, cmd.timeout ?? 15000));
				try {
					const result = await piRef.exec("bash", ["-c", cmd.command], {
						signal: signal ?? undefined,
						timeout,
						cwd: ctx.cwd,
					});
					const out = (result.stdout ?? "").trim();
					const err = (result.stderr ?? "").trim();
					const combined = [out ? `$ ${cmd.command}\n${out}` : `$ ${cmd.command}\n(no stdout)`, err ? `stderr:\n${err}` : "", `exit:${(result as unknown as { exitCode?: number }).exitCode ?? 0}`].filter(Boolean).join("\n");
					const trunc = truncateHead(combined, { maxLines: 400, maxBytes: 15000 });
					return trunc.truncated ? `${trunc.content}\n[truncated ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}]` : trunc.content;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					return `$ ${cmd.command}\n[failed: ${msg.slice(0, 500)}]`;
				}
			};
			let outputs: string[];
			if (params.parallel) {
				outputs = await Promise.all(params.commands.slice(0, 8).map(runOne));
			} else {
				outputs = [];
				for (const c of params.commands.slice(0, 8)) {
					outputs.push(await runOne(c));
					if (signal?.aborted) break;
				}
			}
			state.smartBashes += 1;
			piRef.appendEntry("pi-pilot:smart_bash", { commands: params.commands.map((c) => c.command), at: Date.now() });
			if (ctx.hasUI) ctx.ui.setStatus("pi-pilot", describePilot());
			const combined = outputs.join("\n\n---\n\n");
			const trunc = truncateHead(combined, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			const text = trunc.truncated ? `${trunc.content}\n\n[Output truncated ${formatSize(trunc.outputBytes)}/${formatSize(trunc.totalBytes)}]` : trunc.content;
			return {
				content: [{ type: "text", text }],
				details: { commands: params.commands.map((c) => c.command), count: params.commands.length, parallel: !!params.parallel },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("smart_bash ")) + theme.fg("muted", `${args.commands.length} cmd(s)`), 0, 0);
		},
		renderResult(result, opts, theme) {
			const d = result.details as { count?: number; commands?: string[] } | undefined;
			let t = `${theme.fg("success", "✓")} ${theme.fg("accent", `${d?.count ?? 0} cmd(s)`)}`;
			if (!opts.expanded) t += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "expand")})`)}`;
			else t += `\n${(d?.commands ?? []).slice(0, 3).map((c) => ` ${theme.fg("muted", c.slice(0, 60))}`).join("\n")}`;
			return new Text(t, 0, 0);
		},
	});

	pi.registerTool(smartEditTool);
	pi.registerTool(smartReadTool);
	pi.registerTool(smartWriteTool);
	pi.registerTool(smartBashTool);
	pi.registerTool(thinkTool);
	pi.registerTool(planTool);
	pi.registerTool(gatherTool);

	// -----------------------------------------------------------------------
	// Bash timeout gate — mandatory timeout (fail-safe)
	// -----------------------------------------------------------------------
	pi.on("tool_call", async (event, _ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;
		const input = event.input as { command: string; timeout?: number };
		if (input.timeout == null) {
			input.timeout = 30_000;
			state.bashInjected += 1;
			return undefined;
		}
		if (!Number.isFinite(input.timeout) || input.timeout <= 0) {
			input.timeout = 30_000;
			state.bashInjected += 1;
			return undefined;
		}
		if (input.timeout < 2000) {
			input.timeout = 2000;
			state.bashInjected += 1;
			return undefined;
		}
		if (input.timeout > 120_000) {
			// cap runaway
			input.timeout = 120_000;
		}
		return undefined;
	});

	// Optional: annotate bash results that timed out
	pi.on("tool_result", async (event, _ctx) => {
		if (event.toolName !== "bash") return undefined;
		const details = event.details as { truncated?: boolean; exitCode?: number } | undefined;
		if (details && typeof details.exitCode === "number" && details.exitCode === 124) {
			return {
				content: [
					{ type: "text", text: `${event.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")}\n\n[pi-pilot: bash timed out (mandatory timeout enforced). Narrow the command, add filters, or increase timeout explicitly up to 120s.]` },
				],
			};
		}
		return undefined;
	});

	// -----------------------------------------------------------------------
	// Session lifecycle
	// -----------------------------------------------------------------------
	pi.on("session_start", async (event, ctx) => {
		state.bashInjected = 0;
		state.smartEdits = 0;
		state.smartReads = 0;
		state.smartWrites = 0;
		state.smartBashes = 0;
		state.thinks = 0;
		state.plans = 0;
		state.gathers = 0;
		currentPlan = null;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom") {
				if (entry.customType === "pi-pilot:smart_edit") state.smartEdits += 1;
				if (entry.customType === "pi-pilot:smart_read") state.smartReads += 1;
				if (entry.customType === "pi-pilot:smart_write") state.smartWrites += 1;
				if (entry.customType === "pi-pilot:smart_bash") state.smartBashes += 1;
				if (entry.customType === "pi-pilot:think") state.thinks += 1;
				if (entry.customType === "pi-pilot:gather") state.gathers += 1;
				if (entry.customType === "pi-pilot:plan" && (entry.data as { action?: string })?.action === "create") {
					const d = entry.data as { goal: string; tasks: string[] };
					currentPlan = { goal: d.goal, tasks: [...d.tasks], done: d.tasks.map(() => false), createdAt: 0 };
				}
				if (entry.customType === "pi-pilot:plan" && currentPlan) {
					const d = entry.data as { action: string; tasks?: string[]; indices?: number[] };
					if (d.action === "add" && d.tasks) {
						currentPlan.tasks.push(...d.tasks);
						currentPlan.done.push(...d.tasks.map(() => false));
					}
					if (d.action === "done" && d.indices) {
						for (const idx of d.indices) if (idx >= 0 && idx < currentPlan.done.length) currentPlan.done[idx] = true;
					}
				}
			}
			if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "pilot_plan") {
				const details = entry.message.details as { plan?: PlanEntry } | undefined;
				if (details?.plan) {
					currentPlan = details.plan;
					state.plans += 1;
				}
			}
		}
		// also scan toolResults for thinks/plans counters
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "toolResult") {
				if (entry.message.toolName === "pilot_think") state.thinks += 0; // already via custom, avoid double
			}
		}
		if (ctx.hasUI) {
			ctx.ui.setStatus("pi-pilot", describePilot());
			if (event.reason !== "startup") ctx.ui.notify(`pi-pilot rebuilt (${event.reason}) — ${describePilot()}`, "info");
		}
	});

	pi.on("session_shutdown", async () => {
		state.bashInjected = 0;
		state.smartEdits = 0;
		state.smartReads = 0;
		state.smartWrites = 0;
		state.smartBashes = 0;
		state.thinks = 0;
		state.plans = 0;
		state.gathers = 0;
		currentPlan = null;
	});

	// -----------------------------------------------------------------------
	// Commands & shortcuts
	// -----------------------------------------------------------------------
	pi.registerCommand("pilot", {
		description: "Show pi-pilot status (counters + current plan)",
		handler: async (_args, ctx) => {
			const msg = describePilot() + (currentPlan ? `\nplan: ${currentPlan.goal}\n${currentPlan.tasks.map((t, i) => ` [${currentPlan!.done[i] ? "x" : " "}] ${i}. ${t}`).join("\n")}` : "\nno active plan");
			if (ctx.hasUI) ctx.ui.notify(msg, "info");
			else piRef.sendMessage({ customType: "pi-pilot:status", content: msg, display: false });
		},
	});

	pi.registerCommand("pilot-think", {
		description: "Quick structured think: /pilot-think <goal> | <hypothesis A> | <hypothesis B> [| <hyp C>]",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /pilot-think goal | hypothesis A | hypothesis B", "warning");
				return;
			}
			const parts = args.split("|").map((s) => s.trim()).filter(Boolean);
			if (parts.length < 3) {
				ctx.ui.notify("Need goal + at least 2 hypotheses separated by |", "warning");
				return;
			}
			piRef.sendUserMessage(JSON.stringify({ tool: "pilot_think", goal: parts[0], hypotheses: parts.slice(1) }), { deliverAs: "steer" });
			// actually invoke via tool: queue a user message that asks model to use tool
			// simpler: notify and let model pick up next turn
			ctx.ui.notify(`pilot_think queued: ${parts[0]}`, "info");
		},
	});

	pi.registerShortcut("ctrl+shift+p", {
		description: "Show pi-pilot status",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(describePilot(), "info");
		},
	});
}

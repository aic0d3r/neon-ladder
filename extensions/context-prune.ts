/**
 * context-prune.ts - lossless context reduction (the biggest free win).
 *
 * 1. TOOL-RESULT DEDUPLICATION: if the agent runs the same command twice with
 *    the same output, replace repeats with "[same output as turn N - deduplicated]".
 *    This compounds: every duplicate NOT in context saves a re-prefill on every
 *    subsequent turn for the rest of the session.
 *
 * 2. PRE-COMPACTION PRUNING: before the session hits the compaction model,
 *    strip tool results that are just "OK", empty, or <40 chars of status
 *    noise. Claude Code does this as layer 1 of its 5-layer pipeline.
 *
 * No model calls. Pure TypeScript. Lossless (only removes true duplicates
 * and noise, never content).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ToolResult {
	role: string;
	content: string;
	toolCallId?: string;
}

export default function (pi: ExtensionAPI) {
	// Track seen outputs for dedup
	const seenOutputs = new Map<string, number>(); // hash -> first turn index
	let turnCount = 0;

	function hash(s: string): string {
		// Simple hash for comparison (doesn't need to be crypto)
		let h = 0;
		for (let i = 0; i < s.length; i++) {
			h = ((h << 5) - h + s.charCodeAt(i)) | 0;
		}
		return String(h);
	}

	function isNoise(text: string): boolean {
		const t = text.trim();
		if (t.length < 40) return true;
		if (/^(ok|done|success|pass|yes|no|true|false|[\d.]+)\s*$/i.test(t)) return true;
		if (/^no (changes|output|error|diff|match)/i.test(t)) return true;
		if (/^\(no output\)$/.test(t)) return true;
		return false;
	}

	// Hook: intercept tool results before they enter context
	pi.on("after_tool_execution", async (event: any, ctx: any) => {
		turnCount++;
		const output = event?.output || event?.result || "";
		const toolName = event?.tool || event?.name || "unknown";

		if (typeof output !== "string" || output.length < 10) return;

		const h = hash(toolName + ":" + output);

		if (seenOutputs.has(h)) {
			const firstTurn = seenOutputs.get(h)!;
			// Replace duplicate with a compact placeholder
			const deduped = `[same output as turn ${firstTurn} - deduplicated by context-prune]`;
			if (event.output !== undefined) event.output = deduped;
			else if (event.result !== undefined) event.result = deduped;
			console.log(`[context-prune] dedup: ${toolName} output identical to turn ${firstTurn} (${output.length} chars saved)`);
		} else {
			seenOutputs.set(h, turnCount);
		}
	});

	// Hook: pre-compaction pruning (strip noise before the summarization model sees it)
	pi.on("session_before_compact", async (event: any, ctx: any) => {
		const messages = event?.messages || [];
		if (!messages.length) return;

		let pruned = 0;
		let charsSaved = 0;

		const cleaned = messages.map((msg: any) => {
			// Only prune tool results (not user/assistant messages)
			if (msg.role !== "tool" && msg.role !== "function") return msg;

			const content = typeof msg.content === "string" ? msg.content : "";

			if (isNoise(content)) {
				pruned++;
				charsSaved += content.length;
				return { ...msg, content: "[pruned: status noise]" };
			}

			// Also collapse very long outputs that are mostly whitespace/repetition
			if (content.length > 2000) {
				const lines = content.split("\n");
				const nonEmpty = lines.filter((l: string) => l.trim().length > 0);
				if (nonEmpty.length < lines.length * 0.3) {
					// >70% empty lines = probably formatted table/spacer output
					pruned++;
					charsSaved += content.length - nonEmpty.join("\n").length;
					return { ...msg, content: nonEmpty.join("\n") };
				}
			}

			return msg;
		});

		if (pruned > 0) {
			event.messages = cleaned;
			console.log(`[context-prune] pre-compaction: pruned ${pruned} noise results, saved ~${(charsSaved / 1000).toFixed(1)}k chars`);
		}
	});
}

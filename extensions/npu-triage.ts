/**
 * npu-triage.ts — passive tool-result summarization on the NPU 2B model.
 *
 * When a tool result exceeds the size threshold, summarize it via qwen3.5-2b
 * on the NPU BEFORE it enters the agent's context. This prevents context
 * bloat without the agent needing to do anything.
 *
 * Differs from ling-tiny-triage in that:
 * 1. It runs on the NPU (no sidecar server needed)
 * 2. It produces a real summary (not just truncation)
 * 3. It fires automatically on tool completion (zero adoption needed)
 *
 * Requires: halogen 0.16+ NPU server on :8731 with qwen3.5-2b loaded.
 * Configure: PI_NPU_TRIAGE_CHARS (default 8000 — results larger than this get summarized)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE = process.env.PI_NPU_BASE || "http://127.0.0.1:8731";
const THRESHOLD = parseInt(process.env.PI_NPU_TRIAGE_CHARS || "8000", 10);
const MAX_CONTEXT = 12000; // chars of original to send as summarization context

async function summarize(text: string, toolName: string): Promise<string | null> {
	try {
		const prompt = `Summarize this ${toolName} output concisely. Keep: error messages, key findings, file names, line numbers, test results. Drop: repeated lines, blank lines, verbose progress output.\n\n${text.slice(0, MAX_CONTEXT)}`;
		const res = await fetch(BASE + "/v1/chat/completions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "qwen3.5-2b",
				messages: [{ role: "user", content: prompt }],
				max_tokens: 500,
			}),
			signal: AbortSignal.timeout(30000),
		});
		if (!res.ok) return null;
		const r = await res.json();
		const summary = r.choices?.[0]?.message?.content;
		return (summary && summary.trim().length > 20) ? summary.trim() : null;
	} catch {
		return null; // fail open — don't block the agent on NPU errors
	}
}

export default function (pi: ExtensionAPI) {
	let triagedCount = 0;
	let charsSaved = 0;

	pi.on("after_tool_execution", async (event: any, ctx: any) => {
		const output = event?.output || event?.result || "";
		const toolName = event?.tool || event?.name || "tool";

		if (typeof output !== "string" || output.length < THRESHOLD) return;

		// Don't summarize code files the agent is reading (they need the full content)
		if (toolName === "read" || toolName === "edit" || toolName === "write") return;

		const summary = await summarize(output, toolName);
		if (!summary) return;

		const saved = output.length - summary.length;
		if (saved < 100) return; // not worth it

		triagedCount++;
		charsSaved += saved;

		// Replace the output with the summary
		if (event.output !== undefined) {
			event.output = `[npu-triage: summarized ${output.length} chars to ${summary.length} chars]\n\n${summary}`;
		} else if (event.result !== undefined) {
			event.result = `[npu-triage: summarized ${output.length} chars to ${summary.length} chars]\n\n${summary}`;
		}

		console.log(`[npu-triage] ${toolName}: ${output.length} -> ${summary.length} chars (saved ${(saved / 1000).toFixed(1)}k)`);
	});

	pi.registerCommand("triage-stats", {
		description: "show npu-triage stats",
		handler: async () => {
			return `triaged: ${triagedCount} outputs | chars saved: ${(charsSaved / 1000).toFixed(1)}k | threshold: ${THRESHOLD} chars`;
		},
	});
}

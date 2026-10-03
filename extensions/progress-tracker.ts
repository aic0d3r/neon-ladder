/**
 * progress-tracker.ts v2 — PROGRESS.md using ACTUAL pi hooks.
 *
 * Available hooks: session_start, session_shutdown, after_provider_response
 * NOT available: after_agent_turn (was used in v1 — didn't work)
 *
 * v2 changes:
 * - Uses after_provider_response to count turns (fires after every LLM response)
 * - Uses session_shutdown for the final PROGRESS.md write (guaranteed to fire)
 * - Uses session_start for resume injection (same as v1)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROGRESS_FILE = "PROGRESS.md";
const WRITE_INTERVAL = 10; // LLM responses (not turns)

export default function (pi: ExtensionAPI) {
	let responseCount = 0;
	let taskDescription = "";

	pi.on("session_start", async (event: any, ctx: any) => {
		const p = path.join(process.cwd(), PROGRESS_FILE);
		if (fs.existsSync(p)) {
			const content = fs.readFileSync(p, "utf8");
			if (content.trim().length > 50) {
				console.log(`[progress-tracker] found PROGRESS.md (${content.length} chars) — injecting as context`);
				if (event && event.messages) {
					event.messages.push({
						role: "user",
						content: `[Session resume] Previous session left this progress note:\n\n${content}\n\nContinue from where the previous session left off.`,
					});
				}
			}
		}
	});

	pi.on("before_agent_start", async (event: any, ctx: any) => {
		if (!taskDescription && event?.messages) {
			const first = event.messages.find((m: any) => m.role === "user");
			if (first) taskDescription = String(first.content || "").slice(0, 300);
		}
	});

	async function writeProgress() {
		const cwd = process.cwd();
		const { code, stdout } = await pi.exec("git", ["diff", "--stat"], { cwd });
		const diffStat = code === 0 ? stdout.trim() : "(no changes)";
		const { code: lc, stdout: ls } = await pi.exec("git", ["log", "--oneline", "-3"], { cwd });
		const recentCommits = lc === 0 ? ls.trim() : "";
		const entry = `# Session Progress\n\n**Task:** ${taskDescription || "(unspecified)"}\n**Last updated:** ${new Date().toISOString()}\n**Responses:** ${responseCount}\n\n## Files modified\n\n\`\`\`\n${diffStat}\n\`\`\`\n\n## Recent commits\n\n\`\`\`\n${recentCommits}\n\`\`\`\n`;
		try {
			fs.writeFileSync(path.join(cwd, PROGRESS_FILE), entry);
			console.log(`[progress-tracker] wrote ${PROGRESS_FILE} at response ${responseCount}`);
		} catch {}
	}

	pi.on("after_provider_response", async (event: any, ctx: any) => {
		responseCount++;
		if (responseCount % WRITE_INTERVAL === 0) await writeProgress();
	});

	pi.on("session_shutdown", async (event: any, ctx: any) => {
		if (responseCount > 0) await writeProgress();
	});
}

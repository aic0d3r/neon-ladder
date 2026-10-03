/**
 * progress-tracker.ts - auto-write PROGRESS.md for session handoff.
 *
 * Every 5 agent turns, write/update a PROGRESS.md in the repo root with:
 * - current task (from the first user message)
 * - files modified (from git diff)
 * - timestamp
 * On session start, if PROGRESS.md exists, inject it as context so the
 * agent starts oriented without re-exploring.
 *
 * This eliminates the 5-10 min of re-exploration that happens when you
 * resume a session after a break.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROGRESS_FILE = "PROGRESS.md";
const WRITE_INTERVAL = 5; // turns

export default function (pi: ExtensionAPI) {
	let turnCount = 0;
	let taskDescription = "";

	// On session start, read PROGRESS.md if it exists
	pi.on("session_start", async (event: any, ctx: any) => {
		const p = path.join(process.cwd(), PROGRESS_FILE);
		if (fs.existsSync(p)) {
			const content = fs.readFileSync(p, "utf8");
			if (content.trim().length > 50) {
				console.log(`[progress-tracker] found existing PROGRESS.md (${content.length} chars) - injecting as context`);
				if (event && event.messages) {
					event.messages.push({
						role: "user",
						content: `[Session resume] Previous session left this progress note:\n\n${content}\n\nContinue from where the previous session left off.`,
					});
				}
			}
		}
	});

	// Track the task from the first user message
	pi.on("before_agent_start", async (event: any, ctx: any) => {
		if (!taskDescription && event?.messages) {
			const first = event.messages.find((m: any) => m.role === "user");
			if (first) {
				taskDescription = String(first.content || "").slice(0, 300);
			}
		}
	});

	// Every N turns, write PROGRESS.md
	pi.on("after_agent_turn", async (event: any, ctx: any) => {
		turnCount++;
		if (turnCount % WRITE_INTERVAL !== 0) return;

		const cwd = process.cwd();
		const { code, stdout } = await pi.exec("git", ["diff", "--stat"], { cwd });
		const diffStat = code === 0 ? stdout.trim() : "(no git repo or no changes)";

		const { code: lc, stdout: ls } = await pi.exec("git", ["log", "--oneline", "-3"], { cwd });
		const recentCommits = lc === 0 ? ls.trim() : "";

		const entry = `# Session Progress\n\n**Task:** ${taskDescription || "(unspecified)"}\n**Last updated:** ${new Date().toISOString()}\n**Turn:** ${turnCount}\n\n## Files modified\n\n\`\`\`\n${diffStat}\n\`\`\`\n\n## Recent commits\n\n\`\`\`\n${recentCommits}\n\`\`\`\n`;

		try {
			fs.writeFileSync(path.join(cwd, PROGRESS_FILE), entry);
			console.log(`[progress-tracker] wrote ${PROGRESS_FILE} at turn ${turnCount}`);
		} catch (e) {
			// write-only, don't fail the session
		}
	});
}

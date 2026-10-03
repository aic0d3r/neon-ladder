/**
 * stop-verify.ts - deterministic verification when the agent says "done".
 *
 * Claude Code uses Stop hooks to prevent premature victory declarations.
 * This does the same: when the agent is about to stop, run syntax checks
 * on any files it modified. If they fail, inject a fix-before-stopping message.
 *
 * Checks: bash -n on .sh, node --check on .js/.ts, python -m py_compile on .py
 * Only checks files modified in this session (via git diff).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_stop", async (event: any, ctx: any) => {
		const cwd = process.cwd();

		// Get modified files from git
		const { code, stdout } = await pi.exec("git", ["diff", "--name-only", "HEAD"], { cwd });
		let modified: string[] = [];
		if (code === 0 && stdout.trim()) {
			modified = stdout.trim().split("\n").filter(Boolean);
		}

		// Also check untracked files
		const { code: uc, stdout: us } = await pi.exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd });
		if (uc === 0 && us.trim()) {
			modified.push(...us.trim().split("\n").filter(Boolean));
		}

		if (!modified.length) return; // nothing to verify

		const failures: string[] = [];

		for (const file of modified) {
			const full = path.join(cwd, file);
			if (!fs.existsSync(full)) continue;

			const ext = path.extname(file);
			let cmd: string[] | null = null;

			if (ext === ".sh") cmd = ["bash", ["-n", full]];
			else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") cmd = ["node", ["--check", full]];
			else if (ext === ".py") cmd = ["python3", ["-m", "py_compile", full]];

			if (!cmd) continue;

			const [prog, args] = cmd;
			const result = await pi.exec(prog, args, { cwd });
			if (result.code !== 0) {
				const err = (result.stderr || result.stdout || "").split("\n").filter(Boolean).slice(0, 3).join(" | ");
				failures.push(`${file}: ${err.slice(0, 200)}`);
			}
		}

		if (failures.length) {
			// Inject a fix-it message instead of letting the agent stop
			const msg = `VERIFICATION FAILED - the following files have syntax errors and must be fixed before stopping:\n${failures.join("\n")}\n\nFix these errors, then try to stop again.`;
			if (event && event.messages) {
				event.messages.push({ role: "user", content: msg });
			}
			console.log(`[stop-verify] ${failures.length} file(s) failed syntax check - blocking stop`);
		} else {
			console.log(`[stop-verify] ${modified.length} modified file(s) all passed syntax check`);
		}
	});
}

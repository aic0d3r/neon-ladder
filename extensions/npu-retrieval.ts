/**
 * NPU retrieval extension - codebase_search tool + /rag-index command.
 *
 * codebase_search(query, k?): semantic search over an indexed directory using
 *   the halogen NPU (qwen3-embedding-0.6b + qwen3-reranker-0.6b). Requires:
 *     - halogen server on :8731 with HALOGEN_NPU_MODELS enabled (0.16.0+)
 *     - an index built once per repo:  rag-index.py --dir <repo>
 *   The tool looks for .npu-index.npz in the current working directory, then
 *   $PI_NPU_INDEX, then ~/.pi/agent/npu-index.npz.
 *
 * /rag-index <dir>: (re)index a directory (runs rag-index.py from neon-ladder).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HOME = os.homedir();
function firstExisting(p: string): string {
	return fs.existsSync(p) ? p : p.replace("/LLMBench/neon-ladder", "/neon-ladder");
}
const RAG_QUERY = firstExisting(path.join(HOME, "neon-ladder-sim2/rag-query.py"));
const RAG_INDEX = firstExisting(path.join(HOME, "neon-ladder-sim2/rag-index.py"));
const BASE = process.env.PI_NPU_BASE || "http://127.0.0.1:8731";

function findIndex(cwd: string): string | null {
	const cands = [
		process.env.PI_NPU_INDEX || "",
		path.join(cwd, ".npu-index.npz"),
		path.join(HOME, ".pi/agent/npu-index.npz"),
	].filter(Boolean);
	for (const c of cands) if (fs.existsSync(c)) return c;
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "codebase_search",
		description:
			"Semantic codebase search over an NPU-indexed repository (embed + rerank on the Ryzen AI NPU, ~100ms). " +
			"Use it to find WHERE something is implemented before reading files. " +
			"Write the query as a FULL natural-language question - e.g. 'where does the runner decide between a repair pass and a full reroll' - not single keywords; the reranker scores whole sentences. Returns top chunks with file paths and relevance scores.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "natural-language search query" },
				k: { type: "number", description: "number of results (default 3)" },
			},
			required: ["query"],
		},
		execute: async (callId: string, args: { query: string; k?: number }) => {
			const cwd = process.cwd();
			const index = findIndex(cwd);
			try { fs.appendFileSync(path.join(HOME, ".pi/agent/npu-retrieval-usage.log"),
				JSON.stringify({ t: new Date().toISOString(), cwd, index: index || "NONE", query: args.query }) + "\n"); } catch {}
			if (!index) {
				return { content: [{ type: "text", text: "No .npu-index.npz found. Build one first: rag-index.py --dir <repo> (needs the halogen NPU server on :8731)." }] };
			}
			const k = args.k ?? 3;
			const argv = [RAG_QUERY, "--query", args.query, "--index", index, "--k", String(k), "--json"];
			const { code, stdout, stderr } = await pi.exec("python3", argv);
			const text = (t: string) => ({ content: [{ type: "text", text: t }] });
			if (code !== 0) return text(`codebase_search failed: ${stderr.slice(0, 300)}`);
			try {
				const parsed = JSON.parse(stdout);
				if (!parsed.results?.length) return text(`No results for: ${args.query}`);
				const lines = parsed.results.map(
					(r: any, i: number) => `${i + 1}. ${r.file}  [${r.score}]\n${r.chunk.slice(0, 700)}`,
				);
				return text(`codebase_search: ${parsed.results.length} results for "${args.query}" (${parsed.latency_s}s, index ${path.basename(index)})\n\n` + lines.join("\n\n"));
			} catch (e) {
				return text(`codebase_search: could not parse rag-query output: ${String(e).slice(0, 200)}\n${stdout.slice(0, 400)}`);
			}
		},
	});

	pi.registerCommand("rag-index", {
		description: "index a directory for NPU retrieval (rag-index.py)",
		handler: async (args: string[]) => {
			const dir = args[0] || process.cwd();
			const out = path.join(dir, ".npu-index.npz");
			const { code, stdout, stderr } = await pi.exec("python3", [RAG_INDEX, "--dir", dir, "--out", out]);
			return code === 0
				? `indexed -> ${out}\n${stdout.trim()}`
				: `rag-index failed:\n${stderr.slice(0, 500)}`;
		},
	});
}

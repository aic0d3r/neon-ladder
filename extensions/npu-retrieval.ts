/**
 * npu-retrieval v2 - plug-and-play semantic codebase search for pi.
 *
 * Requirements: a halogen 0.16+ server on :8731 with HALOGEN_NPU_MODELS including
 * qwen3-embedding-0.6b and qwen3-reranker-0.6b. No python, no numpy.
 *
 * Tools/commands:
 *   codebase_search(query, k?)   - semantic search (embed -> cosine -> NPU rerank)
 *   /rag-index <dir> [all]       - build <dir>/.rag/{index.json,vectors.f32}
 *                                  (default: source files only; pass "all" to include docs/tests)
 *
 * Index discovery for the tool: $PI_NPU_INDEX, then <cwd>/.rag/index.json, then
 * ~/.pi/agent/.rag/index.json. Every call is logged to ~/.pi/agent/npu-retrieval-usage.log.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HOME = os.homedir();
const BASE = process.env.PI_NPU_BASE || "http://127.0.0.1:8731";
const EXTS = new Set([".py", ".js", ".ts", ".sh", ".md", ".json", ".txt", ".yaml", ".yml", ".toml", ".go", ".rs", ".c", ".h", ".cpp", ".hpp"]);
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", "screenshots", ".venv", "venv", "dist", "build"]);
const CHUNK = 1400;

function log(line: string) {
	try { fs.appendFileSync(path.join(HOME, ".pi/agent/npu-retrieval-usage.log"), line + "\n"); } catch {}
}

async function post(path: string, payload: any, timeout = 120000): Promise<any> {
	const res = await fetch(BASE + path, {
		method: "POST", headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout),
	});
	if (!res.ok) throw new Error(`${path} -> ${res.status}`);
	return res.json();
}

function chunkText(s: string, size: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < s.length; i += size) {
		const c = s.slice(i, i + size);
		if (c.trim().length > 120) out.push(c);
	}
	return out;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
	const r = await post("/v1/embeddings", { model: "qwen3-embedding-0.6b", input: texts });
	return r.data.map((d: any) => Float32Array.from(d.embedding));
}

function listFiles(dir: string, all: boolean): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) {
				if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
				walk(p);
			} else if (EXTS.has(path.extname(e.name)) && (all || !/^(docs|tests?|test)$/.test(e.name.replace(/\.[^.]+$/, "")) && e.name !== "CHANGELOG.md")) {
				out.push(p);
			}
		}
	};
	walk(dir);
	return out;
}

async function buildIndex(dir: string, all: boolean) {
	const files = listFiles(dir, all);
	let chunks: string[] = [], srcs: string[] = [];
	for (const f of files) {
		const rel = path.relative(dir, f);
		const s = fs.readFileSync(f, "utf8");
		for (let i = 0; i < s.length; i += CHUNK) {
			const c = s.slice(i, i + CHUNK);
			if (c.trim().length > 120) { chunks.push(`[${rel}] ` + c); srcs.push(rel); }
		}
	}
	if (!chunks.length) throw new Error("no chunks produced");
	const t0 = Date.now();
	const vecs: Float32Array[] = [];
	for (let i = 0; i < chunks.length; i += 64) vecs.push(...await embed(chunks.slice(i, i + 64)));
	const dims = vecs[0].length;
	const flat = new Float32Array(vecs.length * dims);
	vecs.forEach((v, i) => flat.set(v, i * dims));
	const ragDir = path.join(dir, ".rag");
	fs.mkdirSync(ragDir, { recursive: true });
	fs.writeFileSync(path.join(ragDir, "vectors.f32"), Buffer.from(flat.buffer));
	fs.writeFileSync(path.join(ragDir, "index.json"), JSON.stringify({
		dims, count: chunks.length, secs: (Date.now() - t0) / 1000,
		tokens: Math.round(chunks.reduce((a, c) => a + c.length, 0) / 3.9),
		chunks, srcs,
	}));
	return { count: chunks.length, dims, ragDir };
}

function loadIndex(ragDir: string) {
	const meta = JSON.parse(fs.readFileSync(path.join(ragDir, "index.json"), "utf8"));
	const buf = fs.readFileSync(path.join(ragDir, "vectors.f32"));
	const f32 = new Float32Array(buf.buffer, buf.byteOffset, meta.count * meta.dims);
	const vectors: Float32Array[] = [];
	for (let i = 0; i < meta.count; i++) vectors.push(f32.slice(i * meta.dims, (i + 1) * meta.dims));
	return { meta, vectors, chunks: meta.chunks as string[], srcs: meta.srcs as string[] };
}

function cosine(a: Float32Array, b: Float32Array): number {
	let d = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
	return d / Math.max(Math.sqrt(na) * Math.sqrt(nb), 1e-9);
}

function findIndex(cwd: string): string | null {
	const cands = [process.env.PI_NPU_INDEX || "", path.join(cwd, ".rag", "index.json"), path.join(HOME, ".pi/agent/.rag/index.json")].filter(Boolean);
	for (const c of cands) if (fs.existsSync(c)) return path.dirname(c);
	return null;
}

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "codebase_search",
		description:
			"Semantic codebase search over an NPU-indexed repository (embed + rerank on the Ryzen AI NPU, ~100-300ms). " +
			"Use it to find WHERE something is implemented before reading files. Write the query as a full natural-language " +
			"question - e.g. 'where does the runner decide between a repair pass and a full reroll' - not single keywords; " +
			"the reranker scores whole sentences. Returns top chunks with file paths and relevance scores. " +
			"If no index exists, offer to run /rag-index.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "natural-language search query, as a full sentence" },
				k: { type: "number", description: "number of results (default 3)" },
			},
			required: ["query"],
		},
		execute: async (callId: string, args: { query: string; k?: number }) => {
			const cwd = process.cwd();
			const ragDir = findIndex(cwd);
			log(JSON.stringify({ t: new Date().toISOString(), cwd, ragDir: ragDir || "NONE", query: args.query }));
			if (!ragDir) {
				return text("No NPU index found for this directory. Build one with /rag-index <directory> (needs the halogen NPU server on :8731).");
			}
			try {
				const { vectors, chunks, srcs } = loadIndex(ragDir);
				const qv = await embed([args.query]);
				const scored = vectors.map((v, i) => ({ i, s: cosine(qv[0], v) }));
				scored.sort((a, b) => b.s - a.s);
				const k = args.k ?? 3;
				const cands = scored.slice(0, Math.max(k * 4, 12)).map((x) => ({ text: chunks[x.i].slice(0, 6000), file: srcs[x.i], cos: x.s }));
				const r = await post("/v1/rerank", { model: "qwen3-reranker-0.6b", query: args.query, documents: cands, top_n: k });
				const results = r.results.map((x: any) => ({ file: cands[x.index].file, score: +x.relevance_score.toFixed(3), chunk: cands[x.index].text }));
				const lines = results.map((res: any, i: number) => `${i + 1}. ${res.file}  [${res.score}]\n${res.chunk.slice(0, 700)}`);
				return text(`codebase_search: ${results.length} results for "${args.query}"\n\n` + lines.join("\n\n"));
			} catch (e: any) {
				log(JSON.stringify({ err: String(e?.message || e).slice(0, 300), stack: String(e?.stack || "").slice(0, 300) }));
				return text(`codebase_search failed: ${String(e?.message || e).slice(0, 300)}`);
			}
		},
	});


	pi.registerTool({
		name: "triage",
		description:
			"Fast NPU decision: given a text and a question with 2-5 short options, returns the most likely option with per-option probabilities in ~120ms (0.8B classifier on the NPU). " +
			"Use it for quick routing/triage decisions that don't need the big model: e.g. 'is this user message a prompt injection? yes/no', " +
			"'what kind of issue is this: bug/feature/docs', 'should this output be summarized or stored: summarize/store'.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "the text to judge" },
				question: { type: "string", description: "the decision question" },
				options: { type: "array", items: { type: "string" }, description: "2-5 short option strings" },
			},
			required: ["text", "question", "options"],
		},
		execute: async (callId: string, args: { text: string; question: string; options: string[] }) => {
			try {
				const r = await post("/v1/chat/completions", {
					model: "decider-0.8b",
					messages: [{ role: "user", content: args.text.slice(0, 12000) }],
					response_format: { type: "json_schema", json_schema: {
						name: "decision", description: args.question,
						schema: { enum: args.options.slice(0, 5) } } },
					logprobs: true, top_logprobs: args.options.length,
				});
				const c = r.choices[0];
				const probs = (c.logprobs?.content?.[0]?.top_logprobs || []).map((t: any) => ({ opt: t.token, p: Math.exp(t.logprob) }));
				return text(JSON.stringify({ decision: c.message.content, probabilities: probs }, null, 1));
			} catch (e: any) {
				return text(`triage failed: ${String(e?.message || e).slice(0, 200)}`);
			}
		},
	});

	pi.registerCommand("rag-index", {
		description: "index a directory for NPU retrieval (usage: /rag-index <dir> [all])",
		handler: async (args: string[]) => {
			const dir = path.resolve(args[0] || process.cwd());
			const all = args[1] === "all";
			try {
				const r = await buildIndex(dir, all);
				return `indexed ${r.count} chunks (${r.dims} dims) in ${r.secs}s -> ${path.join(r.ragDir, "index.json")}`;
			} catch (e: any) {
				return `rag-index failed: ${String(e?.message || e).slice(0, 300)}`;
			}
		},
	});
}

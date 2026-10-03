# pi extension suite

Extensions that make pi genuinely better for daily agentic coding on Strix Halo.
Install: copy the `.ts` files you want into `~/.pi/agent/extensions/` (pi autodiscovers them).

## The ling-tiny suite (sidecar-model economics)

All of these route prefill-shaped busywork to a small local model (Ling-3.0-tiny, ~4 GB GGUF)
instead of your main model. On this hardware the tiny runs ~2,100 tok/s where a 27B main model
prefills at ~250 tok/s - an 8x difference on exactly the jobs that are pure prefill.

Prerequisites: a llama.cpp server serving `ling3.0-tiny` on `127.0.0.1:8090`, and a pi
`models.json` entry with provider `llamacpp-tiny`, model id `ling3.0-tiny`.

| extension | what it does | saving |
|---|---|---|
| `ling-tiny-compaction.ts` | routes /compact (manual + auto) summarization to tiny | 8x faster compaction |
| `ling-tiny-triage.ts` | compresses oversized bash tool results BEFORE they enter history | smaller context every turn |
| `ling-tiny-commit.ts` | /commit: commit message from the working-tree diff via tiny | seconds instead of main-model turns |
| `ling-tiny-branch-summary.ts` | /tree branch navigation summarizes abandoned entries with tiny | free branch history |
| `ling-tiny-repomap.ts` | /repomap: compact repo map inserted before the first turn | main model starts oriented |

## npu-retrieval.ts (halogen 0.16 NPU)

Three tools + one command, each measured and earned:

| tool | what it does | measured |
|---|---|---|
| `codebase_search(query, k?)` | semantic search (NPU embed + rerank, ~100-300ms) | 15/20 correct-file vs 9/20 for grep on 20 intent queries across 2 repos |
| `dedup_scan(dirs[], threshold?)` | find near-duplicate files across directories | 45 pairs found across 4 repos in 8.4s, catches renames |
| `triage(text, question, options[])` | fast routing decision (0.8B classifier, ~120ms) | 78% on binary decisions; use for guardrail hints and issue classification, NOT as a security boundary |
| `/rag-index <dir>` | build `<dir>/.rag/{index.json,vectors.f32}` | ~5,700 tok/s on NPU |

Requires: halogen 0.16+ NPU server on :8731 with `HALOGEN_NPU_MODELS=decider-0.8b,qwen3-embedding-0.6b,qwen3-reranker-0.6b`.

### Removed after testing (measured too weak to ship)

- `moderate` (qwen3guard-gen-0.6b): 67% accuracy, misses blunt attacks (DAN, rm -rf, SSRF), false-positives on benign testing language. Not a security boundary.
- `npu_write` (qwen3.5-2b): correct output but 16.6 tok/s decode - slower than ling-tiny for the same jobs.

## harness-tune.ts

`/tune [key value]` - live performance knobs from inside pi: compaction threshold,
per-turn token budget, sampling temperature (0 for deterministic benches),
tool-result triage threshold. Reads and writes the real config files with validation.

## Why this suite

The ling-tiny extensions handle the *prefill-shaped* half of session overhead (compaction,
commits, repo maps, tool-result bloat) at 8x the main model's throughput. The NPU extensions
handle the *semantic* half (finding code, detecting duplicates, routing decisions) at ~100ms
per call without touching the iGPU. Together they cover both axes of agent-session cost.

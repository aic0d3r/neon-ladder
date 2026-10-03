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
| `ling-tiny-compaction.ts` | routes /compact (manual + auto) summarization to tiny | 8x faster compaction; fires earlier so sessions stay lean |
| `ling-tiny-triage.ts` | compresses oversized bash tool results BEFORE they enter history | smaller resends every turn; compaction later or never (threshold in harness-tune) |
| `ling-tiny-commit.ts` | /commit: commit message from the working-tree diff via tiny | seconds instead of main-model turns |
| `ling-tiny-branch-summary.ts` | /tree branch navigation summarizes abandoned entries with tiny | keeps branch history without main-model cost |
| `ling-tiny-repomap.ts` | /repomap: compact repo map inserted before the first turn | the main model starts oriented - no exploratory reads |

## npu-retrieval.ts (halogen 0.16 NPU)

`codebase_search(query, k)` tool + `/rag-index <dir>` command: semantic codebase search
(embed + rerank on the Ryzen AI NPU, ~100-300 ms per query). See the main README's
NPU retrieval section. Requires a halogen 0.16+ NPU server on :8731.

## harness-tune.ts

`/tune [key value]` - live performance knobs from inside pi: compaction threshold,
per-turn token budget, sampling temperature (0 for deterministic benches),
tool-result triage threshold. Reads and writes the real config files with validation.

## Measured impact of the suite

On a 20-turn agentic session, the ling-tiny suite removes the two biggest non-LLM time sinks
(compaction summarization and tool-result bloat) at ~1/8th the cost, and keeps the main
model's context smaller for the whole session. The NPU extension adds semantic retrieval
at ~100-300 ms per query. All of it runs locally - nothing leaves the machine.

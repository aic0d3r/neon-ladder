# Neon Ladder — the playtest-graded benchmark for local LLM stacks

**Does your local LLM setup actually work for coding agents, or does it just benchmark well?**

Neon Ladder answers that end-to-end. A coding agent builds a 10-file HTML5 canvas game from a fixed contract, then the build passes through three gates: static checks score the code, a headless browser soaks the running game for two minutes, and a human playtest delivers the final grade.

The benchmark subject is the **whole inference stack**, not just the model. Engine, quant, drafter, speculative decoding, chat template, contract, and effort level all move the result — and most of those variables are invisible to standard benchmarks.

Validated on **llama.cpp (Vulkan) + AMD Strix Halo** with DFlash2 and native-MTP speculative decoding, across Qwen3.8-27B (4 quants) and Qwen3.8-Flash-Next 125B-A6B. Each cell reproduces from this bundle in 5-25 minutes depending on model and effort (~5 on Flash-Next low, ~25 on the 27B at medium).

## How it differs from existing benchmarks

WebGen-Bench measures model capability via multi-file website generation with browser tests. LMGame and BALROG measure agents *playing* games.

Neon Ladder measures your **local configuration** — template effects, spec-decode acceptance, quant behavior — through a real build workload. Runtime verification and playtest are the final grade, because that is where several failure classes live that no static check can see.

## The reference stack

Behind every number I publish:

| layer | what I run |
|---|---|
| Hardware | AMD Strix Halo APU — Ryzen AI MAX+ 395, Radeon 8060S iGPU (gfx1151), 109GB usable unified memory |
| OS / driver | CachyOS Linux, Mesa RADV 26.2.1 system driver, boot args `amdgpu.gttsize=126976 ttm.pages_limit=32505856` |
| Engine | llama.cpp Vulkan — Nathan's strix-halo-vulkan releases (validated v0.6.11 through v0.7.4.1; 0.7.4+ = throughput parity + greedy repeatability fixes) + my [adaptive draft-sizing port](https://github.com/aic0d3r/llama.cpp/tree/adaptive-verify) |
| Models | Qwen3.8-27B: Unsloth UD-Q4_K_XL-v3 (the 27B pick), Q5/Q6/Q8 for the tier map · Qwen3.8-Flash-Next: Unsloth UD-IQ4_XS (87.25GB, sha-pinned) |
| Drafters | DFlash2 Q4_K_M sidecar (27B; adaptive n3-7 or fixed n4) · native MTP head Q8_0 (Flash-Next; fixed n4) |
| KV cache | 27B: f16 target / q8_0 drafter · Flash-Next: q8_0/q8_0 · contexts: 262144 (27B) / 32768-65536 (Flash-Next) |
| Chat template | Sharp v22.4.0 on the 27B (+19% sustained vs stock; flag order matters — see step 1) · embedded template on Flash-Next |
| Agent harness | pi coding agent (0.84.x) + pi-llama-cpp provider, `thinkingTokenBudgetField: "thinking_budget_tokens"`, Qwen card sampling (temp 1.0, top_p 0.95, top_k 20) |
| Gates (this bundle) | static scorer · 120s runtime smoke gate · runner with repair-first retry and server-down abort |

Two engine-driver notes measured on this rig (three-way A/B, same source commit): a **native build beats the portable payload by 6-24%** (JSON-class decode 28.3 → 40.3 t/s), and the **system Mesa stable beat the bundled devel snapshot on agent-relevant classes** (deep decode +9.5%, emission +13%; shallow marginally preferred bundled). Budget GPU memory against `mem_info_vram_total + mem_info_gtt_total` — both heaps count, the Vulkan allocator uses both. This nominal-128GB machine with a 16GB BIOS UMA carve exposes 16 + 109.7 ≈ 125.7 GiB total, split between a pinned VRAM heap and an evictable GTT heap.

One adaptive-drafting boundary is worth flagging: the controller wins on DFlash2 block drafts but loses to fixed n4 on MTP chained drafts, measured both directions on the same harness. Use whichever wins on your stack.

## What's in the bundle

| file | role |
|---|---|
| `contract.txt` | the game contract: file structure, physics, MENU/START + SERVE rules, workflow |
| `game-score.py` | static scorer, 19 checks, including two velocity-multiplication bug detectors |
| `smoke-gate.sh` | 120s runtime soak: boot errors fatal, frame/draw-ops advancement, reload detection |
| `wsmin.js` | raw-WebSocket CDP client the gate polls through |
| `cdp.js` | single-eval CDP client for diagnostics (the gate does not need it) |
| `run.sh` | runner: success = files + SMOKE-OK; boot errors trigger a repair pass, else wipe and reroll |
| `soak-probe.sh` | standalone diagnostic soak for post-mortems |
| `report.sh` | assembles the one-comment result line from run artifacts (auto-invoked by `run.sh` on success) |

Use the bundled scorer with the bundled contract — they are calibrated as a set. Scores from modified contracts or different scorers are not comparable.

## Install

Three dependencies, then two config files.

```bash
# 1. System deps
sudo pacman -S nodejs chromium        # or your distro's equivalents

# 2. The pi coding agent (or build from source: github.com/earendil-works/pi)
yay -S pi-coding-agent-bin

# 3. This bundle
git clone https://github.com/aic0d3r/neon-ladder && cd neon-ladder
```

Wire pi to your llama.cpp server in `~/.pi/agent/models.json` (minimal working entry):

```json
{
  "providers": {
    "llamacpp": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "api": "openai-completions",
      "apiKey": "dummy",
      "models": [{
        "id": "my-model",
        "reasoning": true,
        "contextWindow": 262144,
        "maxTokens": 32768,
        "compat": {
          "thinkingFormat": "chat-template",
          "chatTemplateKwargs": { "reasoning_effort": {"$var": "thinking.effort"}, "enable_thinking": {"$var": "thinking.enabled"} },
          "thinkingTokenBudgetField": "thinking_budget_tokens"
        }
      }]
    }
  }
}
```

## Run

Start your server, run one cell, play the game. Reference server command:

```bash
llama-server -m Qwen3.8-27B-UD-Q4_K_XL.gguf \
  -md Qwen3.8-27B-DFlash2-Q4_K_M.gguf \
  --spec-type draft-dflash --spec-draft-n-max 4 \
  -ngl all -fa on -ctk f16 -ctv f16 -ctkd q8_0 -ctvd q8_0 \
  -c 262144 -b 4096 -ub 4096 --jinja \
  --chat-template-file sharp-v22.4.0.jinja \
  --host 127.0.0.1 --port 8080 --metrics
# KEY: --jinja must come BEFORE --chat-template-file, and never use
# --chat-template with a file path — it fails silently.
```

One bench cell:

```bash
export LLADDER=$HOME/neon-ladder-work && mkdir -p $LLADDER
bash run.sh build-run1 game-run1 medium "$(cat contract.txt)"
# ... typically 15-45 min later, on success the runner prints your result line
```

Open `build-run1/index.html`, press Enter, play two minutes. Then generate the comment:

```bash
QUANT="Q4_K_XL" DRAFTER="DFlash2-Q4_M n4" PLAYTEST="Y - plays well" \
RIG="Strix Halo 395+8060S, Nathan v0.7.3" bash report.sh $LLADDER/build-run1 game-run1
```

That prints (and saves to `RESULT-game-run1.txt`) a line like:

```
Q8_K_XL / DFlash2-Q4_M n4 / medium / 23min / static 17/19 / SMOKE-OK / Y - clean and polished — Strix Halo 395+8060S, 109GB, Nathan v0.7.3
```

Static score, soak verdict, effort, and wall clock are pulled from the run artifacts automatically. You supply quant, drafter, playtest verdict, and rig — the four things only you know.

## Variance rules (so divergent numbers are data, not contradiction)

- Engine-level greedy nondeterminism (stale-KV + a top-k race above ~2k prompt tokens) was real through v0.7.3 and upstream master, and is fixed in v0.7.4. Wall-time variance remains regardless (fix-loop rolls differ between builds): identical configs span 18-79 min. Treat N=1 cells as signals, not conclusions.
- About 1 in 4 cold rolls degenerates — the model answers with code in the reply instead of writing files. The runner wipes and retries these automatically.
- Unsloth re-uploaded quants under the same filenames (v2 → v3). Pin revisions when comparing, or your "same model" is two models.
- Power profile moves decode by a few t/s on APUs. State yours.
- Chat-template flag order is a silent trap (see step 1 in the recipe).

## Requirements

- node (for the CDP clients and `node --check`)
- chromium (headless)
- the [pi](https://github.com/earendil-works/pi) coding agent with a llama.cpp provider
- extensions and skills are **not part of the protocol** — if yours inject context into sessions, disable them (`pi config`) or your numbers will carry a variable the recipe does not account for
- a llama.cpp server with speculative decoding (DFlash2 or MTP capable)

## What to run (every row receipt-backed by this harness)

By available GPU memory (check `mem_info_vram_total + mem_info_gtt_total` — both heaps count):

| budget | stack | what you get |
|---|---|---|
| ~24 GB | Qwen3.8-27B UD-Q4_K_XL + DFlash2 Q4_K_M, fixed n4, ctx ≤64k | the reliable-build config — every 27B receipt above |
| 24–48 GB | same, full 256k ctx | plus IDE/browser headroom — the reference rig |
| 48–91 GB | add the Q8-27B profile for deep-context reading | fastest prefill tier (253 avg / 330 peak t/s) |
| ≥91 GB | Qwen3.8-Flash-Next UD-IQ4_XS + MTP Q8_0, Nathan v0.7.3+ **built natively** (v0.7.4 current), `--reasoning-effort medium --reasoning-budget 2048` (server default — clients that send a per-request budget, e.g. pi, override it), this contract | the speed lane and the daily driver on 128GB: 12-min clean medium builds, 40 t/s sustained decode on low-effort sessions, 353 t/s prefill |

By task:

- **Agentic coding / build-from-scratch**: the 27B profile. Flash-Next is faster per token, but the 27B produced the best working builds; on this contract Flash-Next needed the pad clause below to play clean.
- **Deep-context analysis / RAG-style reading**: Q8-27B — prefill-bound work is the one place big quants win on speed.
- **Emission-heavy agent loops** (tool calls, scaffolding, data transforms): adaptive draft sizing (`--spec-draft-adaptive n3-7`) — +25% on tool-call classes. On MTP stacks, stick to fixed n4 (adaptive loses there). For everything else the two are within 2%.

Three knobs that matter more than they look:

- **Template**: on explicit contracts, decode is a wash; Sharp halves wall time on long sessions, stock produced the deepest build. Never pass a template file path to `--chat-template` — it fails silently (use `--chat-template-file`, `--jinja` first).
- **Engine**: build Nathan's line from source — the portable payload leaves 6-24% on the table. System Mesa stable beat the bundled devel snapshot on agent-relevant classes.
- **Contract**: two per-model blind spots (a serve rule, a pad physics clause) were each cured by one explicit sentence after showing up as systematic failures. When a model tier fails the same way every time, fix the contract before blaming the model.

## Validation results

| stack | contract | verdict |
|---|---|---|
| Qwen3.8-27B (Q4/Q5/Q6/Q8) + DFlash2 | early revisions | 6/6 playable, PPL plateau 7.079–7.089 |
| Qwen3.8-Flash-Next 125B-A6B + native MTP (Nathan v0.7.3) | current | **try-1 SUCCESS, 17/19** — 16 min, 28.6–40.3 t/s decode classes |
| Flash-Next + pad clause (this contract) | current | **fully clean playtest** — 12 min, 30.7 t/s decode, 353 t/s prefill (best measured) |
| 27B + adaptive draft sizing (N=5 cells) | current | 4/5 clean playtests, decode 18.0 vs 17.7 fixed-n4, acceptance 65.3% vs 60.4% |
| Flash-Next low, clean env (manual) | current | **best cell measured**: 5-min build, 40 t/s decode (48.7 peak), 16/19, zero human edits |
| Flash-Next low, 8× budget (1024→8192) | v0.7.3 | 14/19, 9 min — budget raise scored *worse*, cap never engaged: budget is burn-out protection, not a quality knob |
| Flash-Next high, clean env (manual) | v0.7.3 | 16/19, **3056 LOC** (playtest: most polished), ~40 min to artifacts (session reaped at 74); budget cap engaged hard |
| Flash-Next high, N=2 (watcher-harvested) | v0.7.4.1 | **17/19 — ties all-time best**, 2855 LOC, ~40 min to artifacts, heaviest renderer measured (2.5M dops), playtest: best build of the series |
| Flash-Next medium, v0.7.4.1 portable | v0.7.4.1 | 15/19, 17 min, clean exit — **engine validated on v0.7.4.1**; medium N=2 band 15-17/19 |
| 27B low, same clean env (control) | current | 17/19 (1412 LOC, one check over the MoE's 16/19), 39 min, 4.3× the reasoning — quality a wash, 8× the wall time |

Three findings that only an agent workload surfaces:

1. **Chat templates are per-model infrastructure.** Effort kwargs that work on one model's template are silently ignored by another's.
2. **Spec-decode controllers are mechanism-dependent.** Acceptance-adaptive draft sizing wins on block drafters and loses on chained MTP drafts — measured both ways on the same harness.
3. **Fast and healthy ≠ agent-ready.** A stack can benchmark beautifully and still fail to complete a build contract. That gap is the reason this repo exists.
4. **Per-model blind spots are usually spec gaps.** Two models each failed the same subsystem on every roll (a serve rule, a physics clause). One explicit contract sentence cured each — 2-for-2. When a model tier fails the same way every time, fix the contract before blaming the model.
5. **On explicit contracts, model size buys speed, not quality.** At matched effort and environment, a 125B MoE and a 27B landed one check apart on the scorer (16/19 vs 17/19, one shared miss) and both shipped playable builds — the MoE in 7.8× less wall time with 4.3× less reasoning. Pick by your token budget, not by a quality assumption.

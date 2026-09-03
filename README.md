# Neon Ladder, the playtest-graded benchmark for local LLM stacks

**Does your local LLM setup actually work for coding agents, or does it just benchmark well?**

The best build this harness ever measured, 4,204 lines of polished arcade game, 17/19 on the static scorer, had a dead keyboard. The model exported its keymap as a Node module and never wired it into the browser. Syntax checks passed. The two-minute runtime soak ran at 60fps with 2.5M draw calls. Then a human pressed Enter and nothing happened, because the first keydown threw on an undefined global and took the entire input system with it.

That's failure class #14. There are fourteen others, and every one was found the same way: by a person playing the game. Zero were found by static analysis. That gap is the reason this repo exists.

## What a run measures

Not the model. Your **whole inference stack**: engine, quant, drafter, speculative decoding, chat template, contract wording, thinking budget. Several of these move the result more than the model choice does, and standard benchmarks can't see any of them.

One cell:

1. A coding agent gets a fixed contract: build "Neon Overdrive", a 10-file HTML5 canvas breakout game. Exact file list, physics rules, serve behavior, pacing constants, all specified, all static-checkable.
2. **Static scorer** (19 checks) grades the code: structure, collision correctness, contract compliance, two different velocity-multiplication bug patterns.
3. **Runtime soak** (120s, headless Chromium via raw CDP): boot errors are fatal, frames and draw calls must advance, reloads are detected.
4. **You play it.** Two minutes with the arrow keys. This is the grade that matters. The fifteen failure classes in the ledger all live here.

Wall clock: **5-40 minutes** depending on model and effort tier. The result line is one comment's worth of data, generated for you.

The subject is validated on **llama.cpp (Vulkan) + AMD Strix Halo**, Qwen3.8-27B (four quants) and Qwen3.8-Flash-Next 125B-A6B, with DFlash2 and native-MTP speculative decoding. It will work on any local stack that can run a coding agent; the receipts below are from this rig.

Companion repo with the runnable pi-agent stack (server scripts, wiring, extensions): **[qwen38-strix-halo-harness](https://github.com/aic0d3r/qwen38-strix-halo-harness)**.

## Why not an existing benchmark

| benchmark | what it measures |
|---|---|
| WebGen-Bench | model capability: multi-file website generation, browser tests |
| LMGame / BALROG | agents *playing* games |
| **neon-ladder** | your **local configuration**, through a real build workload |

Model-capability benchmarks can't catch a chat template that silently ignores your effort flags, or a drafter whose acceptance collapses on reasoning-heavy turns. Those are configuration failures, and they're what this harness is built to surface.

## The reference stack

Behind every number published here:

| layer | what I run |
|---|---|
| Hardware | AMD Strix Halo APU, Ryzen AI MAX+ 395, Radeon 8060S iGPU (gfx1151), 109GB usable unified memory |
| OS / driver | CachyOS Linux, Mesa RADV 26.2.1 system driver, boot args `amdgpu.gttsize=126976 ttm.pages_limit=32505856` |
| Engine | llama.cpp Vulkan, Nathan's strix-halo-vulkan releases (validated v0.6.11 through v0.7.4.1; 0.7.4+ = throughput parity + greedy repeatability fixes) + my [adaptive draft-sizing port](https://github.com/aic0d3r/llama.cpp/tree/adaptive-verify) |
| Models | Qwen3.8-27B: [Unsloth UD-Q4_K_XL-v3](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF) (the 27B pick), Q5/Q6/Q8 for the tier map · Qwen3.8-Flash-Next: [Unsloth UD-IQ4_XS](https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF) (87.25GB, sha-pinned) |
| Drafters | [DFlash2 Q4_K_M sidecar](https://huggingface.co/incoai/Qwen3.8-27B-DFlash2-GGUF) (27B; adaptive n3-7 or fixed n4) · [native MTP head Q8_0](https://huggingface.co/EasiiX/Qwen3.8-Flash-Next-MTP-Strix-Halo-GGUF) (Flash-Next; fixed n4) |
| Vision | `mmproj-F16.gguf` from each model repo, passed as `-mm ... --mmproj-offload` on both servers (pi sessions have vision on GPU) |
| KV cache | 27B: f16 target / q8_0 drafter · Flash-Next: q8_0/q8_0 · contexts: 262144 (27B) / 32768-65536 (Flash-Next) |
| Chat template | Sharp v22.4.0 on the 27B (+19% sustained vs stock; flag order matters: see the run recipe) · embedded template on Flash-Next |
| Agent harness | pi coding agent (0.84.x) + pi-llama-cpp provider, `thinkingTokenBudgetField: "thinking_budget_tokens"`, Qwen card sampling (temp 1.0, top_p 0.95, top_k 20) |
| Gates (this bundle) | static scorer · 120s runtime smoke gate · runner with repair-first retry and server-down abort |

Two engine-driver findings that cost real time to learn (three-way A/B, same source commit): a **native build beats the portable payload by 6-24%** on decode (JSON-class 28.3 → 40.3 t/s), and the **system Mesa stable beat the bundled devel snapshot** on agent-relevant classes (deep decode +9.5%, emission +13%). Budget GPU memory against `mem_info_vram_total + mem_info_gtt_total`; both heaps count; the Vulkan allocator uses both. This nominal-128GB machine with a 16GB BIOS UMA carve exposes 16 + 109.7 ≈ 125.7 GiB total, split between a pinned VRAM heap and an evictable GTT heap.

One adaptive-drafting boundary worth knowing before you tune: the acceptance controller wins on DFlash2 block drafts and *loses* to fixed n4 on MTP chained drafts, measured both directions on the same harness. Use whichever wins on your stack, not whichever is newer.

## The bundle

| file | role |
|---|---|
| `contract.txt` | the game contract: file structure, physics, MENU/START + SERVE rules, workflow |
| `game-score.py` | static scorer, 19 checks, versioned + md5-frozen |
| `smoke-gate.sh` | 120s runtime soak: boot errors fatal, frame/draw-ops advancement, reload detection |
| `wsmin.js` | raw-WebSocket CDP client the gate polls through |
| `cdp.js` | single-eval CDP client for diagnostics (the gate does not need it) |
| `run.sh` | runner: success = files + SMOKE-OK; boot errors trigger a repair pass, else wipe and reroll |
| `soak-probe.sh` | standalone diagnostic soak for post-mortems |
| `report.sh` | assembles the one-comment result line from run artifacts (auto-invoked by `run.sh` on success) |

Use the bundled scorer with the bundled contract. They are calibrated as a set. Scores from modified contracts or different scorers are not comparable.

## Install

Three dependencies, then one config file.

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

## Run one cell

Start your server, run the cell, play the game. Reference server command:

```bash
llama-server -m Qwen3.8-27B-UD-Q4_K_XL.gguf \
  -md Qwen3.8-27B-DFlash2-Q4_K_M.gguf \
  -mm mmproj-F16.gguf --mmproj-offload \
  --spec-type draft-dflash --spec-draft-n-max 4 \
  -ngl all -fa on -ctk f16 -ctv f16 -ctkd q8_0 -ctvd q8_0 \
  -c 262144 -b 4096 -ub 4096 --jinja \
  --chat-template-file sharp-v22.4.0.jinja \
  --host 127.0.0.1 --port 8080 --metrics
# KEY: --jinja must come BEFORE --chat-template-file, and never use
# --chat-template with a file path: it fails silently.
```

The cell itself:

```bash
export LLADDER=$HOME/neon-ladder-work && mkdir -p $LLADDER
bash run.sh build-run1 game-run1 medium "$(cat contract.txt)"
# ... typically 15-45 min later, on success the runner prints your result line
```

Open `build-run1/index.html`, press Enter, play two minutes. Then:

```bash
QUANT="Q4_K_XL" DRAFTER="DFlash2-Q4_M n4" PLAYTEST="Y - plays well" \
RIG="Strix Halo 395+8060S, Nathan v0.7.4.1" bash report.sh $LLADDER/build-run1 game-run1
```

That prints (and saves) a line like:

```
Q8_K_XL / DFlash2-Q4_M n4 / medium / 23min / static 17/19 / SMOKE-OK / Y - clean and polished / Strix Halo 395+8060S, 109GB, Nathan v0.7.4.1
```

Static score, soak verdict, effort, and wall clock come from the run artifacts automatically. You supply quant, drafter, playtest verdict, and rig, the four things only you know.

## Reading the numbers (variance rules)

Divergent results are data, not contradiction. If you know the rules:

- **Greedy nondeterminism was an engine bug, not sampling fate.** Stale-KV between requests plus a top-k race above ~2k prompt tokens, real through v0.7.3 *and* upstream master, fixed in v0.7.4. Wall-time variance survives regardless (fix-loop rolls differ between builds): identical configs span 18-79 min. Treat N=1 cells as signals, not conclusions.
- **About 1 in 4 cold rolls degenerates**: the model answers with code in the reply instead of writing files. The runner wipes and retries these automatically.
- **Unsloth re-uploaded quants under the same filenames** (v2 → v3). Pin revisions when comparing, or your "same model" is two models.
- **Power profile moves decode** by a few t/s on APUs. State yours.
- **Chat-template flag order is a silent trap** (see the run recipe).

## What to run

By available GPU memory (check `mem_info_vram_total + mem_info_gtt_total`, both heaps count):

| budget | stack | what you get |
|---|---|---|
| ~24 GB | Qwen3.8-27B UD-Q4_K_XL + DFlash2 Q4_K_M, fixed n4, ctx ≤64k | the reliable-build config, every 27B receipt above |
| 24–48 GB | same, full 256k ctx | plus IDE/browser headroom, the reference rig |
| 48–91 GB | add the Q8-27B profile for deep-context reading | fastest prefill tier (253 avg / 330 peak t/s) |
| ≥91 GB | Qwen3.8-Flash-Next UD-IQ4_XS + MTP Q8_0, Nathan v0.7.3+ **built natively** (v0.7.4.1 current), `--reasoning-effort medium --reasoning-budget 2048` (server default: clients that send a per-request budget, e.g. pi, override it), this contract | the speed lane and the daily driver on 128GB: 12-min clean medium builds, 40 t/s sustained decode on low-effort sessions, 353 t/s prefill |

By task:

- **Agentic coding / build-from-scratch**: Flash-Next at medium effort: best score measured (18/19) and the best speed/quality balance in playtest. The 27B is the pick under ~91GB free or for >131k single sessions.
- **Deep-context analysis / RAG-style reading**: Q8-27B: prefill-bound work is the one place big quants win on speed.
- **Emission-heavy agent loops** (tool calls, scaffolding, data transforms): adaptive draft sizing (`--spec-draft-adaptive n3-7`): +25% on tool-call classes. On MTP stacks, stick to fixed n4 (adaptive loses there). For everything else the two are within 2%.

Three knobs that matter more than they look:

- **Template**: on explicit contracts, decode is a wash; Sharp halves wall time on long sessions, stock produced the deepest build. Never pass a template file path to `--chat-template`: it fails silently (use `--chat-template-file`, `--jinja` first).
- **Engine**: build Nathan's line from source. The portable payload leaves 6-24% on the table. System Mesa stable beat the bundled devel snapshot on agent-relevant classes.
- **Contract**: two per-model blind spots (a serve rule, a pad physics clause) were each cured by one explicit sentence after showing up as systematic failures. When a model tier fails the same way every time, fix the contract before blaming the model.

## The result ledger

Every row is a receipt from this harness. Playtest verdicts are the user's, recorded as given.

| stack | contract era | verdict |
|---|---|---|
| Qwen3.8-27B (Q4/Q5/Q6/Q8) + DFlash2 | early revisions | 6/6 playable, PPL plateau 7.079–7.089 |
| 27B + adaptive draft sizing (N=5 cells) | current | 4/5 clean playtests, decode 18.0 vs 17.7 fixed-n4, acceptance 65.3% vs 60.4% |
| 27B low, clean-env control | current | 17/19 (1412 LOC), 39 min, 4.3× the reasoning of the MoE below, quality a wash, 8× the wall time |
| 27B low / medium / high, N=2 | v0.7.4.1 | 16/19 (43 min) · 13/19 but **plays well** · 15/19, **38 min artifact-complete**: the "84-minute deep build" was verify tail; no 27B tier produces rich builds |
| Flash-Next + native MTP, first try | v0.7.3 | 17/19, 16 min, try-1 SUCCESS |
| Flash-Next + pad clause | current | fully clean playtest: 12 min, 30.7 t/s decode, 353 t/s prefill (best measured) |
| Flash-Next low, clean env | v0.7.3 | 5-min build, 40 t/s decode (48.7 peak), 16/19, zero human edits |
| Flash-Next low, 8× thinking budget | v0.7.3 | 14/19, 9 min. Budget raise scored *worse*, cap never engaged: budget is burn-out protection, not a quality knob |
| Flash-Next medium, N=3 | v0.7.4.1 | **15-18/19. The 18 is the best score measured on this machine**; 12-17 min |
| Flash-Next high, N=2 | v0.7.3 + v0.7.4.1 | 16-17/19, 2855-3056 LOC, ~40 min to artifacts, richest builds, best playtests |
| Flash-Next minimal (256 budget), N=2 | v0.7.4.1 | 14-15/19, 7-9 min, builds a working level 1; **level-progression froze in playtest**: the scaffolding lane, not the game lane |
| Flash-Next xhigh (16384 budget) | v0.7.4.1 | 17/19, **4204 LOC, richest ever**, ~35 min; playtest: keyboard dead on first keydown (class #14) |
| gate runtime v2.2.1 | 2026-09-06 | leak-guard: CDP probes reap their detached chromium group on signal exit; scorer untouched, all scores comparable |

**Final board (2026-09-06):** every effort tier at N≥2 on both models. Static bands fully overlap (13-18). The best score is Flash-Next medium at 18/19. Fifteen playtest-found failure classes; the last three (gameover-exit, dead keyboard, level-2 freeze) were runtime wiring that passed static score *and* the soak.

## Five findings that only an agent workload surfaces

1. **Chat templates are per-model infrastructure.** Effort kwargs that work on one model's template are silently ignored by another's.
2. **Spec-decode controllers are mechanism-dependent.** Acceptance-adaptive draft sizing wins on block drafters and loses on chained MTP drafts, measured both ways on the same harness.
3. **Fast and healthy ≠ agent-ready.** A stack can benchmark beautifully and still fail a build contract. That gap is the reason this repo exists.
4. **Per-model blind spots are usually spec gaps.** Two models each failed the same subsystem on every roll. One explicit contract sentence cured each, 2-for-2.
5. **On explicit contracts, model size buys speed, not quality.** A 125B MoE and a 27B, matched effort and environment: one check apart, both playable, the MoE in 7.8× less wall time with 4.3× less reasoning. Pick by your token budget, not by a quality assumption.

## Requirements

- node (for the CDP clients and `node --check`), chromium (headless)
- the [pi](https://github.com/earendil-works/pi) coding agent with a llama.cpp provider
- a llama.cpp server with speculative decoding (DFlash2 or MTP capable)
- extensions and skills are **not part of the protocol**. If yours inject context into sessions, disable them (`pi config`) or your numbers carry a variable the recipe does not account for

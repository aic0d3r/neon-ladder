# Changelog

## 2026-10-07

- Tagged **v1.0.0** (first tagged release). MIT LICENSE added.
- Model paths in `start-halogen.sh`, `repro/run-gufo-arm.sh` and `cap-eval.py` are now
  env-driven (`MODELS_DIR` / `DEMO_ROOT`) instead of machine-specific absolute paths.

## 2026-10-03

- `smoke-gate.sh`: new **`--fail-fast`** flag (also `FAIL_FAST=1`). The gate now consumes the wsmin poll stream live instead of only after the soak, so a fatal page error, a reload, a stalled rAF loop or stopped draw-ops abort the soak on the poll where they happen and the script exits non-zero immediately, printing the failed check's name on a `FAILED-CHECK <name>` line (so the runner can tell *which* check killed the build). A 120s soak on a build that throws at boot now costs ~10s instead of 120s. Without the flag the gate is byte-for-byte the old behaviour: full soak, same verdicts, same output. `--help` and a missing-argument usage line added while in there.

## 2026-09-12

- `game-score.py` **V2.3**: the serve-glue keyword match is word-bounded. V2.2's `/ready/` matched inside "already", which false-PASSed a build with no serve gate at all. The affected cell drops 17/19 -> 16/19 under V2.3. Behavior is now checked for real by the probe below.
- New **`behavior-probe.sh`** (+ `behavior-probe.js`): real-time scripted playtest on top of the existing CDP client. **SERVE** = the ball must stay put until Space (the current contract's SERVE RULE); **REFLECTION** = a brick collision must flip the ball's velocity, not let it pass through. Validated on four builds: two fail serve (auto-launch), one fails both (destroys 3-6 bricks per pass-through with `vy` unchanged), the llama.cpp reference passes both.
- Reality check that motivated it: the best-scoring cell of that batch (17/19 static) had the worst runtime bug, and the 120s soak passed it because the frames and draw calls kept advancing while the ball ghosted through the grid.

## 2026-09-09

- `run.sh`: pi's `--provider` takes the provider name only. The old `--provider llamacpp/qwen3.8-27b` slash form is silently ignored, so pi fell back to the default provider from settings. Split into `--provider llamacpp --model qwen3.8-27b` on both the main and repair passes.

## 2026-09-07

- README rig table: Models and Drafters rows now link the repos (Unsloth 27B + Flash-Next, incoai DFlash2, EasiiX MTP). New Vision row: `mmproj-F16.gguf` from each model repo, passed as `-mm ... --mmproj-offload` on both servers.
- Reference server command includes `-mm mmproj-F16.gguf --mmproj-offload`.
- A/B (projector GPU vs CPU): no decode impact (25.8 vs 26.5 t/s, acc 0.475 both), so vision is free on this stack.
- v2.12 prompt checked in as the canonical bench prompt (`prompt-multi-v2_12.txt`, md5-frozen in MANIFEST). Adds MENU/START RULE, SERVE RULE, and the verify-input-wiring clause over v2_9. All published cells ran v2_9; runs on v2_12 start a new comparability group.
- v2.4 report.sh: the one-comment line now carries the behavior-probe verdicts (serve/refl) from the runner-written probe log; runtime status is no longer optional context.
- v2.1 behavior probe: full contract checklist (menu start, serve gate, launch-on-Space, pad reflection, ball-loss outcome, brick reflection) with guarded accessors, window-scan ball fallback, DOM game-over signal; RULES line carries per-rule verdicts + tested/passed score.
- v2.2 behavior probe: pacing check (~420 px/s), tri-ball last-ball rule and laser arm/fire (conditional on spawn accessors), shop-persistence via reload boot-branch, default wait raised to 45s.
- v2.3 behavior probe: broad spawn-accessor scan (any module/window export matching spawn/drop/powerup) for tri-ball and laser rules; passive visual brick fallback via canvas pixel-diff for closure-hidden builds; parse-serve-log.py added; power-sample.sh added.
- v3 prompt checked in (prompt-multi-v3.txt): Siege Protocol - drifting armored rows, volatile chain (3 deep), volatile regen with HUD countdown, paddle shrink per level, multiplier reset on paddle touch, level-3 armored-row gate.
- v2.4.1: import os fix in injector; V3 env gate for drift/regen rules (v2_12 builds no longer penalized); lossy second-load merge fixed (full first-run state stashed). Verified: good build 7/7 visualRender PASS, gufo med-f 6/7 visualRender FAIL (intermittent blank gameplay screen - the build the user caught).
- v2.4.2: second-load check now replays the player path (Enter -> sample -> Space -> sample, retry once) instead of sampling the menu canvas - DOM-menu builds were false-flagged flaky. Verified: 5 previously flagged builds PASS, med-f still FAIL.
- toolcall-test.py (structured tool-call reliability, n-request JSON validation) and c4-test.py (concurrent streaming aggregate t/s) checked in.
- shot.js: mkdir -p the output dir before writing - the runner auto-shot silently failed on every fresh cell (screenshots/ never existed). Now creates it.
- npu-retrieval v2: SELF-CONTAINED TS extension (index build + search, no python at query time), stdlib-only rag-index.py writing the interchange format (.rag/index.json + vectors.f32), cap-eval.py capability benchmark. Verified live: pi answers from NPU retrieval correctly.
- smoke-gate.sh: --fail-fast option (first failed check kills the soak immediately, names the check) + two real gate-bug fixes found during the NPU agent session (grep block-buffering via --line-buffered, trailing newline in SERIES accumulation).

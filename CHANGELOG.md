# Changelog

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

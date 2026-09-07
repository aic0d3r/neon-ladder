# Changelog

## 2026-09-07

- README rig table: Models and Drafters rows now link the repos (Unsloth 27B + Flash-Next, incoai DFlash2, EasiiX MTP). New Vision row: `mmproj-F16.gguf` from each model repo, passed as `-mm ... --mmproj-offload` on both servers.
- Reference server command includes `-mm mmproj-F16.gguf --mmproj-offload`.
- A/B (projector GPU vs CPU): no decode impact (25.8 vs 26.5 t/s, acc 0.475 both), so vision is free on this stack.

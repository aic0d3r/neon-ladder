# Reproducing the 2026-09-30 halogen-vs-gufo numbers (70 W tablet, 128 GB)
Rig: Ryzen AI Max+ 395, gfx1151, 128 GB UMA, 70 W board limit (BIOS).
Halogen 0.15.1: docker image ghcr.io/peonist-ai/halogen-flash-server:latest; native arm
CHECKPOINT=/models/qwen38-flash-next-v2.hgn (+ ngram.hgn sidecar beside it), GGUF arm
HALOGEN_CHECKPOINT=<UD-IQ4_XS shard> + qwen38-flash-next-mtp.hgn + tokenizer/ beside it.
Gufo 0.3.0: image ghcr.io/gufo-org/toolboxes/gufo-runtime:latest, Unsloth UD-Q4_K_XL
(4 shards) + MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf, adaptive MTP.
Decode/prefill client: LLMBench/scripts/bench/halogen-cmp.py --base <url> --nonce
--extra '{"enable_thinking":false}' (halogen) or '{"reasoning_effort":"none"}' (gufo),
10 coding prompts x 1024 tok, temperature 0; depth prompts ~2.4k/9.6k/19k/38k tokens.
Pre-flight: free 2 MiB pages >= 200 (fadvise models tree; else root drop_caches).
NEVER quote decode from repeated identical prompts on prompt-cache engines without --nonce.
Agent cells: harness bench/run-game-bench-v2.sh (effort-keyed budgets, smoke gate,
pixel-rule probe, auto-screenshots), prompt-multi-v2_12/v3 in this repo.

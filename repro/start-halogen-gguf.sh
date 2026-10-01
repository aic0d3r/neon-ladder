#!/usr/bin/env bash
# halogen 0.7.0 in bring-your-own-GGUF mode: runs the SAME unsloth UD-IQ4_XS
# file our v0741 stack reads, so engine-vs-engine comparisons and game cells
# are same-weights. Layout per their README: shards + qwen38-flash-next-mtp.hgn
# + tokenizer/ beside each other under /models (mounted read-only, no
# HALOGEN_DOWNLOAD, image stays offline). Same buddyinfo guard as start-halogen.sh
# (GGUF mode pins ~72 GiB, 4 GiB more than the own checkpoint).
#
#   ./start-halogen-gguf.sh                    # serve on 8731
#   CACHE=0 ./start-halogen-gguf.sh            # pp-sweep arm
#   HALOGEN_ARGS="sweep ..." ./start-halogen-gguf.sh
: "${LLMBENCH:=$HOME/LLMBench}"
W=$LLMBENCH/models/halogen-gguf
IMG=ghcr.io/peonist-ai/halogen-flash-server:${TAG:-0.7.0}

ORDER9=$(awk '$4=="Normal"{print $(NF-1)}' /proc/buddyinfo)
if [ "${FORCE:-0}" != 1 ] && [ "${ORDER9:-0}" -lt 200 ] 2>/dev/null; then
  echo "refusing to start: only ${ORDER9:-?} free 2 MiB blocks (order-9) on Normal." >&2
  echo "(FORCE=1 to start anyway and eat the compaction stall)" >&2
  exit 1
fi
for f in qwen38-flash-next-mtp.hgn tokenizer/merges.txt \
         Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf; do
  [ -r "$W/$f" ] || { echo "missing $W/$f" >&2; exit 1; }
done
RENDER_GID=$(stat -c %g /dev/dri/renderD128)
VIDEO_GID=$(stat -c %g /dev/dri/card1)
ENV_ARGS=(-e HALOGEN_KV_SLOTS="${SLOTS:-4}" -e HALOGEN_CHECKPOINT=/models/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf)
[ -n "${POOL:-}" ] && ENV_ARGS+=(-e "HALOGEN_KV_POOL_POSITIONS=$POOL")
[ -n "${CTX:-}" ] && ENV_ARGS+=(-e "HALOGEN_CTX=$CTX")
[ -n "${CACHE:-}" ] && ENV_ARGS+=(-e "HALOGEN_PROMPT_CACHE=$CACHE")
[ -n "${TEMPERATURE:-}" ] && ENV_ARGS+=(-e "HALOGEN_TEMPERATURE=$TEMPERATURE")
[ -n "${TOP_P:-}" ] && ENV_ARGS+=(-e "HALOGEN_TOP_P=$TOP_P")
[ -n "${TOP_K:-}" ] && ENV_ARGS+=(-e "HALOGEN_TOP_K=$TOP_K")
[ -n "${MIN_P:-}" ] && ENV_ARGS+=(-e "HALOGEN_MIN_P=$MIN_P")
exec docker run --rm -i \
  --device /dev/kfd --device /dev/dri \
  --group-add "$RENDER_GID" --group-add "$VIDEO_GID" \
  --security-opt seccomp=unconfined --ipc=host --ulimit memlock=-1:-1 \
  "${ENV_ARGS[@]}" \
  -e HALOGEN_STARTUP_PROGRESS=1 -e HALOGEN_VERBOSE=1 \
  -v "$W":/models:ro \
  -p 127.0.0.1:8731:8731 \
  "$IMG" ${HALOGEN_ARGS:-}

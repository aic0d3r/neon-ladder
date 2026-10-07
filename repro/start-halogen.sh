#!/usr/bin/env bash
# halogen 0.4.4: closed-source ROCm engine for Qwen3.8-Flash-Next on gfx1151.
# Serves an OpenAI API on 127.0.0.1:8731 (their default publishes all
# interfaces; we bind loopback only because the engine protocol has no auth).
#
# EULA section 4 expressly permits running and publishing benchmarks; the only
# asks are stating the image version and the prompt set used. Do both.
# No HALOGEN_DOWNLOAD is set: with it unset the image makes no outbound
# connections at all, and /models is mounted read-only.
#
# Modes (image entrypoint): all (default) | engine | api | bench | sweep.
#   ./start-halogen.sh                 # serve
#   HALOGEN_ARGS="sweep -p 512 -n 128 -d serial,mtp -r 1" ./start-halogen.sh
: "${LLMBENCH:=$HOME/LLMBench}"
W=$LLMBENCH/models/halogen-qwen3.8-flash-next
IMG=ghcr.io/peonist-ai/halogen-flash-server:${TAG:-0.5.0}

# shellcheck disable=SC2086
# --group-add render/video is what their docs suggest under docker, but this
# host's /dev/kfd and /dev/dri/renderD128 are both world-rw and docker resolves
# group names against the image, which has no `render` entry. GIDs instead.
#
# PRE-FLIGHT: this engine pins ~68 GiB in 2 MiB pages and reserves a multi-GB KV
# pool up front. If the host has no contiguous 2 MiB blocks free it does not fail,
# it thrashes kernel compaction at 100% of one core with no output for tens of
# minutes (their docs name this state; we hit it after a 121 GiB model download
# filled the page cache). /proc/buddyinfo order-9 is the 2 MiB block count.
ORDER9=$(awk '$4=="Normal"{print $(NF-1)}' /proc/buddyinfo)
if [ "${FORCE:-0}" != 1 ] && [ "${ORDER9:-0}" -lt 200 ] 2>/dev/null; then
  echo "refusing to start: only ${ORDER9:-?} free 2 MiB blocks (order-9) on Normal." >&2
  echo "halogen needs tens of thousands. As root, with no other big model resident:" >&2
  echo "  sync; echo 3 > /proc/sys/vm/drop_caches; echo 1 > /proc/sys/vm/compact_memory" >&2
  echo "then re-check: awk '\$4==\"Normal\"{print \$(NF-1)}' /proc/buddyinfo" >&2
  echo "(FORCE=1 to start anyway and eat the compaction stall)" >&2
  exit 1
fi
RENDER_GID=$(stat -c %g /dev/dri/renderD128)
VIDEO_GID=$(stat -c %g /dev/dri/card1)
# SLOTS/POOL are our knobs, not required by them. Their defaults are 4 slots over
# a 524288-position pool (~35 GiB), which needs a host of its own. We benchmark
# single-stream to match our own server's --parallel 1, and their docs state that
# pool/slot choice changes residency only: "each one's speed and its answers are
# unchanged". Their published per-request numbers stay reproducible under either.
ENV_ARGS=(-e HALOGEN_KV_SLOTS="${SLOTS:-4}")
[ -n "${CHECKPOINT:-}" ] && ENV_ARGS+=(-e "HALOGEN_CHECKPOINT=$CHECKPOINT")
[ -n "${POOL:-}" ] && ENV_ARGS+=(-e "HALOGEN_KV_POOL_POSITIONS=$POOL")
[ -n "${CTX:-}" ] && ENV_ARGS+=(-e "HALOGEN_CTX=$CTX")
[ -n "${RESERVE:-}" ] && ENV_ARGS+=(-e "HALOGEN_HOST_RESERVE_GIB=$RESERVE")
# CACHE=0 disables the prompt cache (their HALOGEN_PROMPT_CACHE=0), which the pp
# sweep arm needs: with the default mode 2, repeated filler prompts resume from
# cache and prefill reads as hundreds of thousands of t/s.
[ -n "${CACHE:-}" ] && ENV_ARGS+=(-e "HALOGEN_PROMPT_CACHE=$CACHE")
# 0.5.9+ server-side sampling defaults. Applied only when the request omits the
# field, so a temp-0 request still decodes greedy and takes none of these.
[ -n "${TEMPERATURE:-}" ] && ENV_ARGS+=(-e "HALOGEN_TEMPERATURE=$TEMPERATURE")
[ -n "${TOP_P:-}" ] && ENV_ARGS+=(-e "HALOGEN_TOP_P=$TOP_P")
[ -n "${TOP_K:-}" ] && ENV_ARGS+=(-e "HALOGEN_TOP_K=$TOP_K")
[ -n "${MIN_P:-}" ] && ENV_ARGS+=(-e "HALOGEN_MIN_P=$MIN_P")
# VISION=1 arms the image tower (0.5.0+): HALOGEN_VISION_TOWER=1 picks the
# qwen38-flash-next-vision.hgn sidecar sitting beside the checkpoint.
[ -n "${VISION:-}" ] && ENV_ARGS+=(-e "HALOGEN_VISION_TOWER=1")
exec docker run --rm -i \
  --device /dev/kfd --device /dev/dri \
  --group-add "$RENDER_GID" --group-add "$VIDEO_GID" \
  --security-opt seccomp=unconfined --ipc=host --ulimit memlock=-1:-1 \
  "${ENV_ARGS[@]}" \
  -e HALOGEN_STARTUP_PROGRESS=1 -e HALOGEN_VERBOSE=1 \
  -v "$W":/models:ro \
  -p 127.0.0.1:8731:8731 \
  "$IMG" ${HALOGEN_ARGS:-}

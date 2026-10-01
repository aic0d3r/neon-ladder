#!/usr/bin/env bash
# gufo runtime container battery/depth driver. ARM=ar|mtp  QUANT=q4kxl|iq4xs
set -u
ARM=${1:-ar}
case "${2:-q4kxl}" in
  iq4xs) MDIR=/home/ezflow/LLMBench/models/qwen38-flash-next; M=UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf;;
  *)     MDIR=/home/ezflow/LLMBench/models/qwen38-flash-next; M=UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf;;
esac
RENDER_GID=$(stat -c %g /dev/dri/renderD128); VIDEO_GID=$(stat -c %g /dev/dri/card1)
SPEC=()
[ "$ARM" = mtp ] && SPEC=(--speculative mtp --mtp-model /models/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf)
exec docker run --rm \
  --device /dev/kfd --device /dev/dri \
  --group-add "$RENDER_GID" --group-add "$VIDEO_GID" \
  --ipc=host --ulimit memlock=-1:-1 \
  -p 127.0.0.1:8080:8080 \
  -v "$MDIR":/models:ro \
  ghcr.io/gufo-org/toolboxes/gufo-runtime:latest \
  gufo serve llm --served-model-name qwen3.8-flash-next -m "/models/$M" --think off -c 65536 -j 2 \
  -i 0.0.0.0 -p 8080 "${SPEC[@]}"

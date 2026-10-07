#!/usr/bin/env bash
# restart halogen with the checkpoint set up by setup.sh (cache ON - never add HALOGEN_PROMPT_CACHE=0)
exec docker run --rm -i \
  --device /dev/accel/accel0 --device /dev/kfd --device /dev/dri \
  -v /sys:/host/sys \
  -v /usr/lib/libxrt_coreutil.so.2:/opt/xilinx/xrt/lib/libxrt_coreutil.so.2:ro \
  -v /usr/lib/libxrt_core.so.2:/opt/xilinx/xrt/lib/libxrt_core.so.2:ro \
  -v /usr/lib/libxrt_driver_xdna.so.2:/usr/lib/libxrt_driver_xdna.so.2:ro \
  -e HALOGEN_CHECKPOINT=/models/qwen38-flash-next-v2.hgn \
  --group-add "988" --group-add "984" \
  --security-opt seccomp=unconfined --ipc=host --ulimit memlock=-1:-1 \
  -v "${MODELS_DIR:-$HOME/models/halogen-qwen3.8-flash-next}":/models:ro -p 127.0.0.1:8731:8731 \
  ghcr.io/peonist-ai/halogen-flash-server:latest

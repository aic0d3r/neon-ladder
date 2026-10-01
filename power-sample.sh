#!/usr/bin/env bash
# power-sample.sh - log Strix Halo package power + SCLK during a bench.
# Usage: power-sample.sh OUT.csv [DURATION_S]   (default 900s, 5s interval)
# power1_average is milliwatts; converted to W in the analysis, not here.
OUT=${1:?need output csv}
DUR=${2:-900}
F=/sys/class/drm/card1/device/hwmon/hwmon4
[ -r "$F/power1_average" ] || F=$(dirname $(ls /sys/class/drm/card*/device/hwmon/*/power1_average 2>/dev/null | head -1))
[ -d "$F" ] || { echo "no power hwmon found" >&2; exit 1; }
echo "epoch_s,power1_average_mw,sclk_mhz" > "$OUT"
end=$(( $(date +%s) + DUR ))
while [ "$(date +%s)" -lt "$end" ]; do
  P=$(cat "$F/power1_average" 2>/dev/null)
  C=$(cat "$F/freq1_input" 2>/dev/null)
  echo "$(date +%s),${P:-},${C:-}" >> "$OUT"
  sleep 5
done

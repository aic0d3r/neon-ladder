#!/usr/bin/env bash
# Print a ready-to-paste one-comment result line from a finished run's artifacts.
# Usage: report.sh <build-dir> <run-name>   (env: QUANT=, DRAFTER=, PLAYTEST=Y|N)
set -u
B=$(readlink -f "$1"); NAME=$2
L=${LLADDER:-$(dirname "$B")}
G=$(dirname "$(readlink -f "$0")")

QUANT=${QUANT:-"<quant>"}; DRAFTER=${DRAFTER:-"<drafter>"}
EFFORT=$(cut -d' ' -f2 "$L/meta-$NAME" 2>/dev/null || echo "<effort>")
PLAYTEST=${PLAYTEST:-"<Y|N playtest>"}; RIG=${RIG:-"<rig>"}

# static score (last STATIC line)
STATIC=$(python3 "$G/game-score.py" "$B" 2>/dev/null | grep -oE 'STATIC SCORE: [0-9]+/[0-9]+' | tail -1 | grep -oE '[0-9]+/[0-9]+')
STATIC=${STATIC:-"?/19"}

# soak verdict (newest smoke log for this name)
SOAK=$(grep -hoE 'SMOKE-(OK|FAIL)[^ ]*( |$)' "$L"/smoke-$NAME-*.log 2>/dev/null | tail -1 | tr -d ' ')
SOAK=${SOAK:-"?"}
[ -z "$SOAK" ] && SOAK="?"

# wall: first build artifact -> run output last write
START=$(find "$B" -type f -printf '%T@\n' 2>/dev/null | sort -n | head -1 | cut -d. -f1)
[ -z "$START" ] && START=0
# END: newest smoke log for this run (written after the build finished; wall includes the 2-min soak)
END=$(stat -c %Y "$L"/smoke-$NAME-*.log 2>/dev/null | sort -n | tail -1)
[ -z "$END" ] && END=$START
WALL=$(( (${END:-0} - ${START:-0}) / 60 )); [ "$WALL" -lt 0 ] && WALL=0

LINE="$QUANT / $DRAFTER / $EFFORT / ${WALL}min / static $STATIC / $SOAK / $PLAYTEST — $RIG"
echo "$LINE" | tee "$L/RESULT-$NAME.txt"

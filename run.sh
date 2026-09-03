#!/usr/bin/env bash
# retry a pi -p game run until it produces real output. KEY: each try appends a unique
# marker to the prompt (model+template are prompt-brittle: identical retries inherit the
# degenerate turn via KV carryover and re-roll nothing).
L=${LLADDER:-$HOME/qwen38-game-ladder}
HERE=$(dirname "$(readlink -f "$0")")   # gate/scorer live beside run.sh
DIR=$1 NAME=$2 LVL=$3; shift 3
mkdir -p $L/$DIR
for TRY in 1 2 3 4 5; do
  cd $L/$DIR || exit 1
  P="$(printf '%s ' "$@") [attempt $TRY $(date +%s)]"
  echo "$NAME $LVL" > $L/meta-$NAME
  timeout 5400 pi -p --no-skills --no-context-files --provider llamacpp/qwen3.8-27b --thinking $LVL --name $NAME "$P" > $L/run-$NAME.txt 2>&1
  if [ "$(find $L/$DIR -name '*.js' -o -name '*.html' -o -name '*.css' 2>/dev/null | wc -l)" -gt 0 ]; then
    if bash $HERE/smoke-gate.sh $L/$DIR > $L/smoke-$NAME-$TRY.log 2>&1; then
      echo "=== $NAME try=$TRY SUCCESS (files + SMOKE-OK) ===" >> $L/ladder.log
    bash "$(dirname "$(readlink -f "$0")")/report.sh" $L/$DIR $NAME 2>/dev/null
    exit 0
    fi
    # TIER 1: localized boot error -> REPAIR (keep files, inject diagnosis; no wipe)
    LOC=$(grep -oE '^ERRLOC .*' $L/smoke-$NAME-$TRY.log | head -1 | cut -d' ' -f2-)
    if [ -n "$LOC" ] && [ "$LOC" != "-" ] && [ ! -f $L/$DIR/.repair-used ]; then
      echo "=== $NAME try=$TRY SMOKE-FAIL w/ diagnosis $LOC -> REPAIR mode (files kept) ===" >> $L/ladder.log
      touch $L/$DIR/.repair-used
      cd $L/$DIR || exit 1
      P2="$(printf '%s ' "$@") A previous attempt exists in this directory. The browser reports a fatal error at $LOC (see console message below if given). Diagnose and REPAIR only the broken code with the edit tool - do NOT rewrite or touch working files. Re-run node --check on all js, then verify index.html script tags, then report. [repair attempt $(date +%s)]"
      timeout 5400 pi -p --no-skills --no-context-files --provider llamacpp/qwen3.8-27b --thinking $LVL --name $NAME "$P2" > $L/run-$NAME-repair.txt 2>&1
      rm -f $L/$DIR/.repair-used
      if bash $HERE/smoke-gate.sh $L/$DIR > $L/smoke-$NAME-repair.log 2>&1; then
        echo "=== $NAME REPAIR SUCCESS (targeted fix, files preserved) ===" >> $L/ladder.log
    bash "$(dirname "$(readlink -f "$0")")/report.sh" $L/$DIR $NAME 2>/dev/null
    exit 0
      fi
      echo "=== $NAME REPAIR failed -> wipe + full reroll ===" >> $L/ladder.log
    fi
    echo "=== $NAME try=$TRY files ok, SMOKE-FAIL (broken build), retrying ===" >> $L/ladder.log; rm -rf $L/$DIR/*; sleep 3; continue
  fi
  if [ "$(stat -c%s $L/run-$NAME.txt)" -gt 10000 ]; then
    echo "=== $NAME try=$TRY FILES-NOT-REPLY (code in response, no writes), retrying ===" >> $L/ladder.log; rm -rf $L/$DIR/*; sleep 3; continue
  fi
  # extensions can inject context the protocol does not account for; warn loudly
PIEXT=$(pi list 2>/dev/null | grep -c . || true)
[ "${PIEXT:-0}" -gt 0 ] && echo "NOTE: ${PIEXT} extension(s) active - disable via 'pi config' if they inject context; results assume none do" >> $L/ladder.log

# a failed try is only a model roll if the server is still alive;
  # check twice with a settle window to catch servers dying mid-try
  if ! curl -s --max-time 3 http://127.0.0.1:8080/health 2>/dev/null | grep -q ok; then
    echo "=== $NAME try=$TRY SERVER DOWN - ABORT ===" >> $L/ladder.log; exit 2
  fi
  sleep 2
  if ! curl -s --max-time 3 http://127.0.0.1:8080/health 2>/dev/null | grep -q ok; then
    echo "=== $NAME try=$TRY SERVER DOWN - ABORT ===" >> $L/ladder.log; exit 2
  fi
  echo "=== $NAME try=$TRY degenerate (prompt-basin), perturbing ===" >> $L/ladder.log; sleep 3
done
echo "=== $NAME FAILED 5 tries ===" >> $L/ladder.log

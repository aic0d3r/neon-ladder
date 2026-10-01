#!/usr/bin/env python3
"""parse-serve-log.py - turn table from an engine serve log.
Handles: halogen 'serve_api: mtp N tok in Ts = X t/s | ...' lines and
gufo '[http] request=rN ... generated_tokens=N ... decode_tps=X ... acceptance_pct=A'.
Usage: parse-serve-log.py SERVER.LOG [--csv OUT.csv]"""
import re, sys, csv

def halogen(s):
    out = []
    for m in re.finditer(r'serve_api: (\w+) (\d+) tok in ([\d.]+)s = ([\d.]+) t/s \| (\d+) rounds, commit ([\d.]+)/round \| prompt (\d+), prefill ([\d.]+)s', s):
        mode, tok, secs, tps, rounds, commit, prompt, pp = m.groups()
        think = 'think on' in s[m.start():m.start()+400]
        out.append(dict(engine_mode=mode, tokens=int(tok), secs=float(secs), tps=float(tps),
                        rounds=int(rounds), commit=float(commit), prompt=int(prompt),
                        prefill_s=float(pp), think=think))
    return out

def gufo(s):
    out = []
    for m in re.finditer(r'path=/v1/chat/completions status=\d+ duration_ms=([\d.]+).*?prompt_tokens=(\d+).*?generated_tokens=(\d+).*?decode_tps=([\d.]+)(?:.*?acceptance_pct=([\d.]+))?', s):
        dur, pin, gen, tps, acc = m.groups()
        out.append(dict(engine_mode='mtp-or-ar', tokens=int(gen), secs=float(dur)/1000, tps=float(tps),
                        prompt=int(pin), acceptance=float(acc) if acc else None))
    return out

def main():
    log, csvout = sys.argv[1], None
    if '--csv' in sys.argv:
        csvout = sys.argv[sys.argv.index('--csv') + 1]
    s = open(log, errors='replace').read()
    rows = halogen(s) or gufo(s)
    if not rows:
        print("no per-request lines recognized"); return 1
    keys = sorted({k for r in rows for k in r})
    w = csv.DictWriter(sys.stdout, fieldnames=keys)
    w.writeheader()
    for r in rows: w.writerow(r)
    tot_t = sum(r['tokens'] for r in rows); tot_s = sum(r['secs'] for r in rows)
    tps = [r['tps'] for r in rows]
    print(f"# turns={len(rows)} generated={tot_t} decode_secs={tot_s:.0f} in_cell_avg={tot_t/tot_s:.1f} t/s turn_min={min(tps)} turn_max={max(tps)}", file=sys.stderr)
    if csvout:
        with open(csvout, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=keys); w.writeheader()
            for r in rows: w.writerow(r)
    return 0

if __name__ == '__main__':
    sys.exit(main())

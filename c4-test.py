#!/usr/bin/env python3
"""c4-test.py - N concurrent streaming generations, per-stream + aggregate t/s.
Usage: c4-test.py --base URL --model ID --workers 4 [--extra '{...}']"""
import argparse, json, urllib.request, threading, time
ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True); ap.add_argument("--model", default=None)
ap.add_argument("--workers", type=int, default=4); ap.add_argument("--extra", default="{}")
ap.add_argument("--max-tokens", type=int, default=512)
a = ap.parse_args()
results = [None]*a.workers
def worker(i):
    variants = ["Write a Python function that merges two sorted lists.", 
                "Write a Python function that flattens a nested dict.",
                "Write a Python function that finds prime numbers up to N.",
                "Write a Python function that reverses words in a sentence.",
                "Write a Python function that computes a checksum of a string.",
                "Write a Python function that deduplicates a list preserving order."]
    payload = {"messages":[{"role":"user","content":f"[c4 run {i}] {variants[i % len(variants)]} Include doctests and 20 lines of usage examples."}],
               "max_tokens":a.max_tokens, "temperature":0, "stream":True}
    if a.model: payload["model"] = a.model
    payload.update(json.loads(a.extra))
    req = urllib.request.Request(a.base.rstrip("/")+"/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type":"application/json"})
    n=0; first=last=None
    t0=time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            for raw in r:
                line = raw.decode("utf-8","replace").strip()
                if not line.startswith("data:"): continue
                if line[5:].strip() == "[DONE]": break
                try: ev = json.loads(line[5:])
                except Exception: continue
                for ch in ev.get("choices", []):
                    d = ch.get("delta") or {}
                    if d.get("content"):
                        now = time.monotonic()
                        first = first or now; last = now; n += 1
        wall = last - first if first and last else time.monotonic()-t0
        results[i] = {"worker": i, "tokens": n, "wall_s": round(wall,1), "tps": round(n/max(wall,1e-9),1)}
    except Exception as e:
        results[i] = {"worker": i, "error": str(e)[:100]}
ts = time.monotonic()
threads = [threading.Thread(target=worker, args=(i,)) for i in range(a.workers)]
for t in threads: t.start()
for t in threads: t.join()
total_wall = time.monotonic() - ts
ok = [r for r in results if r and "tps" in r]
agg = sum(r["tokens"] for r in ok) / max(total_wall,1e-9)
print(json.dumps({"workers": a.workers, "streams": ok, "aggregate_tps": round(agg,1), "total_wall_s": round(total_wall,1)}, indent=1))

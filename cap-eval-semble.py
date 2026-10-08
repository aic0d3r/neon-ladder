#!/usr/bin/env python3
"""cap-eval-semble.py - third arm for cap-eval.py: semble (MinishLab, CPU hybrid
embed+BM25) on the same 20 intent queries, same top-3 file-level scoring.
Usage: cap-eval-semble.py [--skip-grep]"""
import argparse, json, re, subprocess, time

ap = argparse.ArgumentParser()
ap.add_argument("--skip-grep", action="store_true")
a = ap.parse_args()

STOP = set("""where how what does do is are the a an and or of for to in on at it its this that
with without from into per by as be been when while which whose if then else not no yes my i
you your we our they their""".split())

EVAL = [
 ("/home/ezflow/demo/httpx", "Where is the timeout applied when sending a new Request instance?", ["httpx/_client.py"]),
 ("/home/ezflow/demo/httpx", "How does the client build the SSL context when verify is False but a client certificate is set?", ["httpx/_config.py"]),
 ("/home/ezflow/demo/httpx", "How do proxies get selected and applied per request?", ["httpx/_transports/default.py"]),
 ("/home/ezflow/demo/httpx", "How does the client follow redirects and enforce the redirect limit?", ["httpx/_client.py"]),
 ("/home/ezflow/demo/httpx", "Where are authentication flows like digest auth implemented?", ["httpx/_auth.py"]),
 ("/home/ezflow/demo/httpx", "How are retries handled for failed connection attempts?", ["httpx/_transports/default.py"]),
 ("/home/ezflow/demo/httpx", "Where is the multipart file upload encoding built?", ["httpx/_content.py"]),
 ("/home/ezflow/demo/httpx", "How does the client decide HTTP/1.1 versus HTTP/2 transport?", ["httpx/_transports/default.py"]),
 ("/home/ezflow/demo/httpx", "Where do connection errors get wrapped into httpx exceptions?", ["httpx/_exceptions.py"]),
 ("/home/ezflow/demo/httpx", "How is the base URL joined with a relative request path?", ["httpx/_urls.py", "httpx/_urlparse.py"]),
 ("/home/ezflow/demo/fastapi", "How are dependencies resolved and injected per request?", ["fastapi/dependencies/utils.py"]),
 ("/home/ezflow/demo/fastapi", "Where is the OpenAPI schema generated from the routes?", ["fastapi/openapi/utils.py"]),
 ("/home/ezflow/demo/fastapi", "How does the router register endpoints and paths?", ["fastapi/routing.py"]),
 ("/home/ezflow/demo/fastapi", "Where are query, body and file parameters declared and validated?", ["fastapi/params.py"]),
 ("/home/ezflow/demo/fastapi", "How does the application run startup and shutdown lifespan handlers?", ["fastapi/applications.py"]),
 ("/home/ezflow/demo/fastapi", "Where are security schemes like OAuth2 and API keys implemented?", ["fastapi/security"]),
 ("/home/ezflow/demo/fastapi", "How are request validation errors converted to JSON error responses?", ["fastapi/exception_handlers.py"]),
 ("/home/ezflow/demo/fastapi", "Where are background tasks executed after the response is sent?", ["fastapi/background.py", "fastapi/routing.py"]),
 ("/home/ezflow/demo/fastapi", "How does the framework build middleware stacks?", ["fastapi/applications.py"]),
 ("/home/ezflow/demo/fastapi", "Where are response models serialized and validated before returning?", ["fastapi/routing.py"]),
]

def keywords(q):
    return [w for w in re.findall(r"[a-zA-Z_]{3,}", q) if w.lower() not in STOP]

def grep_search(root, query, k=3):
    t0 = time.monotonic()
    kws = keywords(query)
    scores = {}
    rootn = root.rstrip("/") + "/"
    for kw in kws[:6]:
        try:
            out = subprocess.run(["grep", "-ric", "--include=*.py", kw, root],
                                 capture_output=True, text=True, timeout=60).stdout
        except Exception:
            continue
        for line in out.strip().splitlines():
            if ":" not in line: continue
            f, c = line.rsplit(":", 1)
            try: scores[f] = scores.get(f, 0) + int(c)
            except ValueError: pass
    ranked = sorted(scores.items(), key=lambda x: -x[1])[:k]
    files = [f.replace(rootn, "") for f, _ in ranked]
    return files, time.monotonic() - t0

from semble import SembleIndex

indexes = {}
build_t = {}
for root in sorted({e[0] for e in EVAL}):
    t0 = time.monotonic()
    indexes[root] = SembleIndex.from_path(root)
    build_t[root] = time.monotonic() - t0
    print(f"index built: {root} in {build_t[root]:.2f}s")

sb_hit = sb_lat = 0
gr_hit = gr_lat = 0
for root, q, truth in EVAL:
    t0 = time.monotonic()
    results = indexes[root].search(q, top_k=3)
    files = [r.chunk.file_path for r in results]
    lat = time.monotonic() - t0
    ok = any(any(t in f for t in truth) for f in files)
    sb_hit += ok; sb_lat += lat
    line = ("SB✓ " if ok else "SB✗ ") + q[:46] + f" | sb_top={files[0].split('/')[-1] if files else '-'}"
    if not a.skip_grep:
        gfiles, glat = grep_search(root, q)
        gok = any(any(t in f for t in truth) for f in gfiles)
        gr_hit += gok; gr_lat += glat
        line = ("rg✓ " if gok else "rg✗ ") + line + f" rg_top={gfiles[0].split('/')[-1] if gfiles else '-'}"
    print(line)

n = len(EVAL)
print(f"\nsemble: {sb_hit}/{n} top-3, mean {sb_lat/n*1000:.0f} ms/query")
if not a.skip_grep:
    print(f"grep baseline: {gr_hit}/{n} top-3, mean {gr_lat/n*1000:.0f} ms/query")

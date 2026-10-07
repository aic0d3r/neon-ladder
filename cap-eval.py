#!/usr/bin/env python3
"""cap-eval.py - NPU semantic retrieval vs ripgrep baseline on intent queries.
Usage: cap-eval.py [--base http://127.0.0.1:8731]"""
import json, math, os, re, subprocess, time, urllib.request

BASE = "http://127.0.0.1:8731"
STOP = set("""where how what does do is are the a an and or of for to in on at it its this that
with without from into per by as be been when while which whose if then else not no yes my i
you your we our they their""".split())

EVAL = [
 # (repo_index, query, ground_truth_substrings(any-match), note)
 ("/tmp/idx-httpx-src.npz", "Where is the timeout applied when sending a new Request instance?", ["httpx/_client.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "How does the client build the SSL context when verify is False but a client certificate is set?", ["httpx/_config.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "How do proxies get selected and applied per request?", ["httpx/_transports/default.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "How does the client follow redirects and enforce the redirect limit?", ["httpx/_client.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "Where are authentication flows like digest auth implemented?", ["httpx/_auth.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "How are retries handled for failed connection attempts?", ["httpx/_transports/default.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "Where is the multipart file upload encoding built?", ["httpx/_content.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "How does the client decide HTTP/1.1 versus HTTP/2 transport?", ["httpx/_transports/default.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "Where do connection errors get wrapped into httpx exceptions?", ["httpx/_exceptions.py"], "impl"),
 ("/tmp/idx-httpx-src.npz", "How is the base URL joined with a relative request path?", ["httpx/_urls.py", "httpx/_urlparse.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "How are dependencies resolved and injected per request?", ["fastapi/dependencies/utils.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "Where is the OpenAPI schema generated from the routes?", ["fastapi/openapi/utils.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "How does the router register endpoints and paths?", ["fastapi/routing.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "Where are query, body and file parameters declared and validated?", ["fastapi/params.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "How does the application run startup and shutdown lifespan handlers?", ["fastapi/applications.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "Where are security schemes like OAuth2 and API keys implemented?", ["fastapi/security"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "How are request validation errors converted to JSON error responses?", ["fastapi/exception_handlers.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "Where are background tasks executed after the response is sent?", ["fastapi/background.py", "fastapi/routing.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "How does the framework build middleware stacks?", ["fastapi/applications.py"], "impl"),
 ("/tmp/idx-fastapi-src.npz", "Where are response models serialized and validated before returning?", ["fastapi/routing.py"], "impl"),
]

def keywords(q):
    return [w for w in re.findall(r"[a-zA-Z_]{3,}", q) if w.lower() not in STOP]

_CACHE = {}
def npu_search(index, query, k=20):
    def post(path, payload):
        req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(req, timeout=120))
    import numpy as np
    t0 = time.monotonic()
    qv = post("/v1/embeddings", {"model": "qwen3-embedding-0.6b", "input": [query]})["data"][0]["embedding"]
    if index not in _CACHE:
        z = np.load(index, allow_pickle=False)
        _CACHE[index] = (z["vectors"].astype(np.float32), z["chunks"], z["srcs"])
    vecs, chunks, srcs = _CACHE[index]
    qv = np.array(qv, dtype=np.float32)
    vnorm = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9)
    sims = vnorm @ (qv / (np.linalg.norm(qv) + 1e-9))
    top = np.argsort(-sims)[:k]
    cands = [{"text": str(chunks[i])[:6000], "file": str(srcs[i])} for i in top]
    r = post("/v1/rerank", {"model": "qwen3-reranker-0.6b", "query": query,
        "documents": cands, "top_n": 3})
    files = [cands[x["index"]]["file"] for x in r["results"]]
    return files, time.monotonic() - t0

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

np_hit = np_lat = 0
gr_hit = gr_lat = 0
for index, q, truth, note in EVAL:
    import os
    root = os.path.join(os.environ.get("DEMO_ROOT", os.path.expanduser("~/demo")), "httpx" if "httpx" in index else "fastapi")
    files, lat = npu_search(index, q)
    ok = any(any(t in f for t in truth) for f in files)
    np_hit += ok; np_lat += lat
    gfiles, glat = grep_search(root, q)
    gok = any(any(t in f for t in truth) for f in gfiles)
    gr_hit += gok; gr_lat += glat
    print(("NPU✓ " if ok else "NPU✗ ") + ("rg✓ " if gok else "rg✗ ") + q[:46] +
          f" | npu_top={files[0].split('/')[-1]} rg_top={gfiles[0].split('/')[-1] if gfiles else '-'}")
print(f"\nNPU semantic: {np_hit}/20 top-3, mean {np_lat/20*1000:.0f} ms/query")
print(f"ripgrep baseline: {gr_hit}/20 top-3, mean {gr_lat/20*1000:.0f} s/query")

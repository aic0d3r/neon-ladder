#!/usr/bin/env python3
"""cap-eval-hybrid.py - fourth arm: BM25+vector hybrid (RRF) + NPU rerank.
Same 20 intent queries, same top-3 file-level scoring as cap-eval.py.
Vector part = same npz stores; lexical part = BM25 over the indexed chunks;
merge = reciprocal rank fusion (k=60), top-20 candidates -> NPU rerank -> top-3.
Usage: cap-eval-hybrid.py [--k1 1.5] [--b 0.75] [--rrf 60] [--cands 20]"""
import argparse, json, math, re, time, urllib.request
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument("--k1", type=float, default=1.5)
ap.add_argument("--b", type=float, default=0.75)
ap.add_argument("--rrf", type=int, default=60)
ap.add_argument("--cands", type=int, default=20)
a = ap.parse_args()

STOP = set("""where how what does do is are the a an and or of for to in on at it its this that
with without from into per by as be been when while which whose if then else not no yes my i
you your we our they their""".split())

def toks(t):
    return [w.lower() for w in re.findall(r"[a-zA-Z_]{3,}", t) if w.lower() not in STOP]

EVAL = [
 ("/tmp/idx-httpx-src.npz", "Where is the timeout applied when sending a new Request instance?", ["httpx/_client.py"]),
 ("/tmp/idx-httpx-src.npz", "How does the client build the SSL context when verify is False but a client certificate is set?", ["httpx/_config.py"]),
 ("/tmp/idx-httpx-src.npz", "How do proxies get selected and applied per request?", ["httpx/_transports/default.py"]),
 ("/tmp/idx-httpx-src.npz", "How does the client follow redirects and enforce the redirect limit?", ["httpx/_client.py"]),
 ("/tmp/idx-httpx-src.npz", "Where are authentication flows like digest auth implemented?", ["httpx/_auth.py"]),
 ("/tmp/idx-httpx-src.npz", "How are retries handled for failed connection attempts?", ["httpx/_transports/default.py"]),
 ("/tmp/idx-httpx-src.npz", "Where is the multipart file upload encoding built?", ["httpx/_content.py"]),
 ("/tmp/idx-httpx-src.npz", "How does the client decide HTTP/1.1 versus HTTP/2 transport?", ["httpx/_transports/default.py"]),
 ("/tmp/idx-httpx-src.npz", "Where do connection errors get wrapped into httpx exceptions?", ["httpx/_exceptions.py"]),
 ("/tmp/idx-httpx-src.npz", "How is the base URL joined with a relative request path?", ["httpx/_urls.py", "httpx/_urlparse.py"]),
 ("/tmp/idx-fastapi-src.npz", "How are dependencies resolved and injected per request?", ["fastapi/dependencies/utils.py"]),
 ("/tmp/idx-fastapi-src.npz", "Where is the OpenAPI schema generated from the routes?", ["fastapi/openapi/utils.py"]),
 ("/tmp/idx-fastapi-src.npz", "How does the router register endpoints and paths?", ["fastapi/routing.py"]),
 ("/tmp/idx-fastapi-src.npz", "Where are query, body and file parameters declared and validated?", ["fastapi/params.py"]),
 ("/tmp/idx-fastapi-src.npz", "How does the application run startup and shutdown lifespan handlers?", ["fastapi/applications.py"]),
 ("/tmp/idx-fastapi-src.npz", "Where are security schemes like OAuth2 and API keys implemented?", ["fastapi/security"]),
 ("/tmp/idx-fastapi-src.npz", "How are request validation errors converted to JSON error responses?", ["fastapi/exception_handlers.py"]),
 ("/tmp/idx-fastapi-src.npz", "Where are background tasks executed after the response is sent?", ["fastapi/background.py", "fastapi/routing.py"]),
 ("/tmp/idx-fastapi-src.npz", "How does the framework build middleware stacks?", ["fastapi/applications.py"]),
 ("/tmp/idx-fastapi-src.npz", "Where are response models serialized and validated before returning?", ["fastapi/routing.py"]),
]

BASE = "http://127.0.0.1:8731"
def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))

import numpy as np

class Arm:
    def __init__(self, index):
        z = np.load(index, allow_pickle=False)
        self.vecs = z["vectors"].astype(np.float32)
        self.chunks = [str(c) for c in z["chunks"]]
        self.srcs = [str(s) for s in z["srcs"]]
        self.vnorm = self.vecs / (np.linalg.norm(self.vecs, axis=1, keepdims=True) + 1e-9)
        # BM25 tables
        self.docs = [toks(c) for c in self.chunks]
        self.dl = np.array([len(d) for d in self.docs], dtype=np.float32)
        self.avgdl = float(self.dl.mean() or 1.0)
        self.tfs = [Counter(d) for d in self.docs]
        df = Counter()
        for d in self.docs:
            df.update(set(d))
        n = len(self.docs)
        self.idf = {t: math.log(1.0 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.cache = {}

    def vec_rank(self, q):
        qv = np.array(post("/v1/embeddings", {"model": "qwen3-embedding-0.6b", "input": [q]})["data"][0]["embedding"], dtype=np.float32)
        sims = self.vnorm @ (qv / (np.linalg.norm(qv) + 1e-9))
        return list(np.argsort(-sims)[:self.vecs.shape[0]])

    def bm25_rank(self, q):
        qt = toks(q)
        scores = np.zeros(len(self.docs), dtype=np.float32)
        for t in set(qt):
            idf = self.idf.get(t)
            if idf is None: continue
            for i, tf in enumerate(self.tfs):
                f = tf.get(t, 0)
                if f:
                    scores[i] += idf * f * (a.k1 + 1.0) / (f + a.k1 * (1.0 - a.b + a.b * self.dl[i] / self.avgdl))
        return list(np.argsort(-scores)[:self.vecs.shape[0]])

    def hybrid(self, q, max_per_file=2):
        vr, br = self.vec_rank(q), self.bm25_rank(q)
        rrf = Counter()
        for r, lst in ((0, vr), (1, br)):
            for rank, i in enumerate(lst):
                rrf[i] += 1.0 / (a.rrf + rank + 1)
        cands, seen = [], Counter()
        for i, _ in rrf.most_common():
            if seen[self.srcs[i]] >= max_per_file:
                continue
            seen[self.srcs[i]] += 1
            cands.append(i)
            if len(cands) >= a.cands:
                break
        return cands

def rerank(q, arm, idxs, k=3):
    r = post("/v1/rerank", {"model": "qwen3-reranker-0.6b", "query": q,
        "documents": [{"text": arm.chunks[i][:6000]} for i in idxs], "top_n": k})
    return [arm.srcs[idxs[x["index"]]] for x in r["results"]]

arms = {}
hb_hit = hb_lat = 0
for index, q, truth in EVAL:
    if index not in arms:
        arms[index] = Arm(index)
        print(f"arm ready: {index} ({len(arms[index].chunks)} chunks)")
    arm = arms[index]
    t0 = time.monotonic()
    cands = arm.hybrid(q)
    files = rerank(q, arm, cands)
    lat = time.monotonic() - t0
    ok = any(any(t in f for t in truth) for f in files)
    hb_hit += ok; hb_lat += lat
    print(("HY✓ " if ok else "HY✗ ") + q[:46] + f" | hy_top={files[0].split('/')[-1] if files else '-'}")

n = len(EVAL)
print(f"\nhybrid (BM25+vector RRF -> NPU rerank): {hb_hit}/{n} top-3, mean {hb_lat/n*1000:.0f} ms/query")

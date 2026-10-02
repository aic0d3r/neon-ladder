#!/usr/bin/env python3
"""rag-index.py - index a directory into an NPU-retrievable store.

Chunks every text file, embeds the chunks on the halogen NPU
(qwen3-embedding-0.6b), and writes vectors + chunks to a .npz store.

Usage:
  rag-index.py --dir <dir> [--out <index.npz>] [--base http://127.0.0.1:8731]
               [--chunk 1400] [--exclude '(\\.git|screenshots|node_modules)']
"""
import argparse, json, os, sys, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--dir", required=True)
ap.add_argument("--out", default=None, help="index path (default <dir>/.npu-index.npz)")
ap.add_argument("--base", default="http://127.0.0.1:8731")
ap.add_argument("--chunk", type=int, default=1400, help="chars per chunk (~350 tok)")
ap.add_argument("--exclude", default=r"(\.git|node_modules|__pycache__|screenshots|\.npz$)")
ap.add_argument("--ext", default=".py,.md,.sh,.js,.ts,.json,.txt,.yaml,.yml,.toml")
ap.add_argument("--src-only", action="store_true", help="skip docs/tests for where-is-it-implemented precision")
a = ap.parse_args()
from array import array

out = a.out or os.path.join(a.dir, ".npu-index.npz")
exts = tuple(a.ext.split(","))
excl = a.exclude
files, chunks, srcs = [], [], []
for dp, _, fns in os.walk(a.dir):
    if any(x in dp for x in (".git", "node_modules", "__pycache__", "screenshots")):
        continue
    for fn in fns:
        if not fn.endswith(exts) or fn.startswith("."):
            continue
        if a.src_only and (any(p in ("docs", "tests", "test") for p in dp.split(os.sep)) or fn.endswith(".md")):
            continue
        p = os.path.join(dp, fn)
        if excl and __import__("re").search(excl, p):
            continue
        try:
            s = open(p, errors="replace").read()
        except OSError:
            continue
        rel = os.path.relpath(p, a.dir)
        for i in range(0, len(s), a.chunk):
            c = s[i:i + a.chunk]
            if len(c.strip()) > 120:
                chunks.append(f"[{rel}] " + c)
                srcs.append(rel)
if not chunks:
    sys.exit("no chunks produced")
print(f"indexing {len(chunks)} chunks from {len(set(srcs))} files ...", file=sys.stderr)

def embed_batch(texts):
    req = urllib.request.Request(a.base + "/v1/embeddings",
        data=json.dumps({"model": "qwen3-embedding-0.6b", "input": texts}).encode(),
        headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    return [d["embedding"] for d in r["data"]]

t0 = time.time()
flat = array("f")
dims = None
for i in range(0, len(chunks), 64):
    for v in embed_batch(chunks[i:i + 64]):
        if dims is None: dims = len(v)
        flat.extend(v)
dt = time.time() - t0
toks = sum(len(c) for c in chunks) / 3.9
rag_dir = os.path.join(os.path.dirname(out) or ".", ".rag")
os.makedirs(rag_dir, exist_ok=True)
with open(os.path.join(rag_dir, "vectors.f32"), "wb") as f:
    flat.tofile(f)
with open(os.path.join(rag_dir, "index.json"), "w") as f:
    json.dump({"dims": dims, "count": len(chunks),
               "secs": round(dt, 1), "tokens": round(toks),
               "chunks": chunks, "srcs": srcs}, f)
print(f"indexed {len(chunks)} chunks ({toks:,.0f} tok) in {dt:.1f}s = {toks/dt:,.0f} tok/s -> {rag_dir}", file=sys.stderr)

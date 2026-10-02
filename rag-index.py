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
a = ap.parse_args()
try:
    import numpy as np
except ImportError:
    sys.exit("numpy required: python3 -m pip install --user numpy")

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
vecs = []
for i in range(0, len(chunks), 64):
    vecs += embed_batch(chunks[i:i + 64])
dt = time.time() - t0
toks = sum(len(c) for c in chunks) / 3.9
np.savez_compressed(out, vectors=np.array(vecs, dtype=np.float32),
                    chunks=np.array(chunks), srcs=np.array(srcs))
print(f"indexed {len(chunks)} chunks ({toks:,.0f} tok) in {dt:.1f}s = {toks/dt:,.0f} tok/s -> {out}", file=sys.stderr)

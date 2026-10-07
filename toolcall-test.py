#!/usr/bin/env python3
"""toolcall-test.py - structured tool-call reliability probe.
Sends N requests that REQUIRE a tool call with strict JSON args, validates each.
Usage: toolcall-test.py --base URL --model ID --extra '{...}' [--n 40] [--out f.jsonl]"""
import argparse, json, urllib.request, random
ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True); ap.add_argument("--model", default=None)
ap.add_argument("--extra", default="{}"); ap.add_argument("--n", type=int, default=40)
ap.add_argument("--out", default=None); ap.add_argument("--seed", type=int, default=None)
a = ap.parse_args()
if a.seed is not None: random.seed(a.seed)
TOOL = {"type":"function","function":{"name":"write_file","description":"Write a file to disk",
 "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}}
TASKS = [
 ("Write the config file js/config.js with canvas 900x640 and 5 brick rows.", "js/config.js"),
 ("Write the stylesheet to css/styles.css with a neon dark theme.", "css/styles.css"),
 ("Write the particle engine to js/particles.js with spawn and update functions.", "js/particles.js"),
 ("Write the state machine to js/states.js with menu, gameplay, paused and game over.", "js/states.js"),
 ("Write the ball module to js/balls.js with paddle reflection from strike position.", "js/balls.js"),
]
hdr = {"Content-Type": "application/json"}
stats = {"n":0,"ok_toolcall":0,"ok_json_args":0,"ok_right_path":0,"ok_nonempty_content":0,"refusals":0,"errors":0,"lat":[]}
out_rows = []
for i in range(a.n):
    task, path = TASKS[i % len(TASKS)]
    payload = {"messages":[
        {"role":"system","content":"You are a coding agent. Use the write_file tool for every file you create. Reply with tool calls only."},
        {"role":"user","content":task + " (seed %d) Call the tool now with the full file content, at least 15 lines." % (a.seed if a.seed is not None else i)}],
      "tools":[TOOL], "tool_choice":"auto", "max_tokens":900, "temperature":0}
    if a.model: payload["model"] = a.model
    payload.update(json.loads(a.extra))
    import time; t0=time.monotonic()
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(a.base.rstrip("/")+"/v1/chat/completions",
            data=json.dumps(payload).encode(), headers=hdr), timeout=120))
        lat = time.monotonic()-t0; stats["lat"].append(lat)
        msg = r["choices"][0]["message"]
        tc = msg.get("tool_calls") or []
        stats["n"] += 1
        if not tc and not (msg.get("content") or "").strip():
            stats["errors"] += 1; out_rows.append({"i":i,"ok":False,"why":"empty"}); continue
        if not (msg.get("content") or "").strip() and not tc:
            stats["refusals"] += 1
        if tc:
            fn = tc[0]["function"]
            args_raw = fn.get("arguments","{}")
            try:
                args = json.loads(args_raw) if isinstance(args_raw,str) else args_raw
                stats["ok_json_args"] += 1
                if isinstance(args,dict) and args.get("path","").endswith(path.split("/")[-1]): stats["ok_right_path"] += 1
                if isinstance(args,dict) and len(str(args.get("content",""))) > 100: stats["ok_nonempty_content"] += 1
                stats["ok_toolcall"] += 1
                out_rows.append({"i":i,"ok":True,"path":args.get("path"),"content_len":len(str(args.get("content","")))})
            except Exception as e:
                out_rows.append({"i":i,"ok":False,"why":"args not JSON: %s" % str(args_raw)[:120]})
                stats["errors"] += 1
        else:
            out_rows.append({"i":i,"ok":False,"why":"no tool_calls", "content_head":(msg.get("content") or "")[:80]})
    except Exception as e:
        stats["n"] += 1; stats["errors"] += 1; out_rows.append({"i":i,"ok":False,"why":"http: %s" % str(e)[:100]})
if stats["lat"]: stats["lat_mean_s"] = round(sum(stats["lat"])/len(stats["lat"]),2); del stats["lat"]
print(json.dumps(stats, indent=1))
if a.out:
    with open(a.out,"w") as f:
        for r in out_rows: f.write(json.dumps(r)+"\n")

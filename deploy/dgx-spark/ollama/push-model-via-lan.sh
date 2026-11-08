#!/usr/bin/env bash
# Installs an Ollama model on a server that can't download from registry.ollama.ai itself
# (e.g. "x509: certificate signed by unknown authority" behind an inspecting firewall).
# This machine downloads the model and streams it straight into the server's Ollama
# (POST /api/blobs, which verifies the SHA-256), then rebuilds it with its original
# template, license, parameters, renderer and parser (POST /api/create).
# Nothing large is stored on this machine.
#
#   ./push-model-via-lan.sh http://192.168.14.123:11434 gpt-oss 20b
#   ./push-model-via-lan.sh http://192.168.14.123:11434 qwen3-coder 30b
set -euo pipefail

SERVER="${1:?Ollama server URL, e.g. http://192.168.14.123:11434}"
REPO="${2:?model name, e.g. gpt-oss}"
TAG="${3:-latest}"
REG="https://registry.ollama.ai/v2/library/$REPO"
ACCEPT="Accept: application/vnd.docker.distribution.manifest.v2+json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> $REPO:$TAG -> $SERVER"
curl -fsSL -H "$ACCEPT" "$REG/manifests/$TAG" -o "$WORK/manifest.json"
curl -fsSL "$REG/blobs/$(python3 -c "import json;print(json.load(open('$WORK/manifest.json'))['config']['digest'])")" -o "$WORK/config.json"

# Small layers (template, license, params) are read here; the model layer is streamed.
python3 - "$WORK" <<'PY'
import json, sys
w = sys.argv[1]
m = json.load(open(f"{w}/manifest.json"))
with open(f"{w}/layers.tsv", "w") as f:
    for l in m["layers"]:
        kind = l["mediaType"].rsplit(".", 1)[-1]
        f.write(f"{kind}\t{l['digest']}\t{l['size']}\n")
PY

MODEL_DIGEST=""
while IFS=$'\t' read -r kind digest size; do
  if [ "$kind" = "model" ]; then
    MODEL_DIGEST="$digest"
    if curl -fsI "$SERVER/api/blobs/$digest" >/dev/null 2>&1; then
      echo "    model file already on the server ($digest)"
    else
      echo "    streaming model file: $((size / 1000000000)) GB ($digest)"
      # The download resumes from the last byte when the internet connection drops;
      # the upload to the server (LAN) stays open the whole time.
      python3 -I - "$REG/blobs/$digest" "$size" <<'PY' \
        | curl -fsS -X POST -T - -H "Content-Type: application/octet-stream" "$SERVER/api/blobs/$digest"
import sys, time, urllib.request
url, size = sys.argv[1], int(sys.argv[2])
out, done, failures, last = sys.stdout.buffer, 0, 0, 0
while done < size:
    try:
        req = urllib.request.Request(url, headers={"Range": f"bytes={done}-"})
        with urllib.request.urlopen(req, timeout=60) as r:
            if done and r.status != 206:
                sys.exit("the registry ignored the resume request")
            while chunk := r.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                failures = 0
                if done - last >= 1 << 30:
                    last = done
                    print(f"    {done / 1e9:.1f} / {size / 1e9:.1f} GB", file=sys.stderr, flush=True)
    except BrokenPipeError:
        sys.exit("the upload to the server was closed")
    except Exception as e:
        failures += 1
        if failures > 20:
            sys.exit(f"download failed: {e}")
        print(f"    connection dropped at {done / 1e9:.2f} GB ({e}); resuming", file=sys.stderr, flush=True)
        time.sleep(min(60, 5 * failures))
out.flush()
PY
      curl -fsI "$SERVER/api/blobs/$digest" >/dev/null || { echo "    upload failed verification"; exit 1; }
      echo "    model file verified on the server"
    fi
  else
    curl -fsSL "$REG/blobs/$digest" -o "$WORK/$kind"
  fi
done < "$WORK/layers.tsv"
[ -n "$MODEL_DIGEST" ] || { echo "no model layer in the manifest"; exit 1; }

python3 - "$WORK" "$REPO:$TAG" "$MODEL_DIGEST" > "$WORK/create.json" <<'PY'
import json, os, sys
w, name, digest = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(f"{w}/config.json"))
req = {"model": name, "files": {"model.gguf": digest}, "stream": False}
if os.path.exists(f"{w}/template"): req["template"] = open(f"{w}/template").read()
if os.path.exists(f"{w}/system"): req["system"] = open(f"{w}/system").read()
if os.path.exists(f"{w}/license"): req["license"] = open(f"{w}/license").read()
if os.path.exists(f"{w}/params"): req["parameters"] = json.load(open(f"{w}/params"))
for k in ("renderer", "parser"):
    if cfg.get(k): req[k] = cfg[k]
print(json.dumps(req))
PY
echo "    creating $REPO:$TAG on the server"
curl -fsS "$SERVER/api/create" -H "Content-Type: application/json" --data-binary "@$WORK/create.json"
echo
echo "==> done: $REPO:$TAG"

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
      curl -fsSL "$REG/blobs/$digest" \
        | curl -fsS -X POST -T - -H "Content-Type: application/octet-stream" "$SERVER/api/blobs/$digest"
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

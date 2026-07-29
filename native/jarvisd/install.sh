#!/usr/bin/env bash
# Install jarvisd venv + Chrome native-messaging host manifest.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="studio.nextsolutions.jarvisd"
MANIFEST_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="${MANIFEST_DIR}/${HOST_NAME}.json"
WRAPPER="${ROOT}/run-jarvisd.sh"
VENV="${ROOT}/.venv"
EXTENSION_ID="${JARVIS_EXTENSION_ID:-}"
# Default: combo-x/extension/manifest.json (two levels up from native/jarvisd)
EXT_MANIFEST="${JARVIS_EXTENSION_MANIFEST:-${ROOT}/../../extension/manifest.json}"

usage() {
  cat <<EOF
Usage: $0 [--extension-id ID] [--dry-run] [--uninstall]

  --extension-id ID   Chrome extension id (or set JARVIS_EXTENSION_ID).
                      If omitted, derived from the public key in
                      extension/manifest.json (SHA-256 → a-p mapping).
  --dry-run           Print the host manifest JSON to stdout; do not write
                      files or create a venv.
  --uninstall         Remove the native-messaging host manifest
EOF
}

# Chrome extension ID from MV3 "key" (base64 SPKI DER):
# first 32 hex chars of SHA-256(DER), each nibble 0-9a-f mapped to a-p.
derive_extension_id() {
  local manifest_path="$1"
  python3 - "$manifest_path" <<'PY'
import base64, hashlib, json, sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    sys.stderr.write(f"error: extension manifest not found: {path}\n")
    sys.exit(2)
mf = json.loads(path.read_text(encoding="utf-8"))
key_b64 = mf.get("key")
if not key_b64 or not isinstance(key_b64, str):
    sys.stderr.write(f"error: no public key in {path}\n")
    sys.exit(2)
der = base64.b64decode(key_b64)
digest = hashlib.sha256(der).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
PY
}

UNINSTALL=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extension-id)
      EXTENSION_ID="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$UNINSTALL" -eq 1 ]]; then
  if [[ -f "$MANIFEST_PATH" ]]; then
    rm -f "$MANIFEST_PATH"
    echo "Removed $MANIFEST_PATH"
  else
    echo "No manifest at $MANIFEST_PATH"
  fi
  exit 0
fi

if [[ -z "$EXTENSION_ID" ]]; then
  if [[ -f "$EXT_MANIFEST" ]]; then
    EXTENSION_ID="$(derive_extension_id "$EXT_MANIFEST")"
    echo "==> Derived extension id from ${EXT_MANIFEST}: ${EXTENSION_ID}"
  else
    cat >&2 <<EOF
error: Chrome extension id required.

Pass --extension-id <id> or set JARVIS_EXTENSION_ID, or place a
manifest with a public "key" at:
  ${EXT_MANIFEST}
EOF
    exit 1
  fi
fi

# Validate id shape (32 chars a-p)
if ! [[ "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "error: extension id must be 32 chars in [a-p] (got: ${EXTENSION_ID})" >&2
  exit 1
fi

MANIFEST_JSON=$(cat <<EOF
{
  "name": "${HOST_NAME}",
  "description": "Jarvis Mac daemon for Combo-X",
  "path": "${WRAPPER}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${EXTENSION_ID}/"]
}
EOF
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "$MANIFEST_JSON"
  # Validate JSON + absolute path + origin
  python3 -c "
import json, sys
m = json.loads(sys.stdin.read())
assert m['type'] == 'stdio'
assert m['path'].startswith('/'), m['path']
assert m['allowed_origins'] == ['chrome-extension://${EXTENSION_ID}/']
print('dry-run ok: absolute path + allowed_origins match', file=sys.stderr)
" <<<"$MANIFEST_JSON"
  exit 0
fi

echo "==> Creating venv at ${VENV}"
python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "${VENV}/bin/activate"
pip install --upgrade pip
pip install -r "${ROOT}/requirements.txt"

echo "==> Writing ${WRAPPER}"
cat > "$WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/.venv/bin/activate"
export PYTHONPATH="${ROOT}${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m jarvisd
EOF
chmod +x "$WRAPPER"

mkdir -p "$MANIFEST_DIR"
printf '%s\n' "$MANIFEST_JSON" > "$MANIFEST_PATH"

echo "Wrote native-messaging host manifest:"
echo "  ${MANIFEST_PATH}"
echo
echo "=== macOS permissions (required) ==="
echo "1) Accessibility"
echo "   System Settings → Privacy & Security → Accessibility"
echo "   Enable the binary that Chrome launches: ${WRAPPER}"
echo "   (or the python3 inside ${VENV}/bin/python)."
echo "   Needed for ui_tree / click / type / key / focus."
echo
echo "2) Screen Recording"
echo "   System Settings → Privacy & Security → Screen Recording"
echo "   Enable the same binary (or Terminal if you launch manually)."
echo "   Needed for screenshot; without it captures are empty/black."
echo
echo "Then reload the Combo-X extension and reconnect the native host."
echo "Done."

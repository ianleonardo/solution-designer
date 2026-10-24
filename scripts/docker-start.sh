#!/usr/bin/env bash
# Start SpecForge in a container on a Linux x86_64 server (Docker or Podman).
# The data folder and the .env file live on the server, outside the container.
#
#   ./scripts/docker-start.sh                                    use the settings below
#   ./scripts/docker-start.sh --data-dir /opt/specforge/data --env-file /opt/specforge/.env --port 8080
#   ./scripts/docker-start.sh --load dist/specforge-latest.tar.gz load a saved image first
#
# The data folder holds the DuckDB database (and its .wal file) and the "uploads" folder; back it up as a whole.
# It is created when missing, and an empty one starts a new database. The .env file is mounted read-only.
# A saved image (--load, or specforge-*.tar.gz in dist/ or beside this script) is loaded when it differs from the
# loaded one, so copying a newer .tar.gz to the server and running this script is enough to upgrade.
# Uses docker, or podman when docker is not installed. Set CONTAINER_ENGINE to choose.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---- settings -------------------------------------------------------------------------------------------------
DATA_DIR="${DATA_DIR:-/opt/specforge/data}"          # data folder: database + uploads
ENV_FILE="${ENV_FILE:-/opt/specforge/.env}"          # the .env file to use
DB_NAME="${DB_NAME:-solutioncrafter.duckdb}"         # database file name inside the data folder
HOST_PORT="${HOST_PORT:-8080}"                       # open http://<server>:HOST_PORT
IMAGE="${IMAGE:-specforge:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-specforge}"
IMAGE_FILE="${IMAGE_FILE:-}"                         # saved image to load when IMAGE is not loaded yet
# ----------------------------------------------------------------------------------------------------------------

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --db-name) DB_NAME="$2"; shift 2 ;;
    --db) DATA_DIR="$(dirname "$2")"; DB_NAME="$(basename "$2")"; shift 2 ;;  # a database file path (older form)
    --port) HOST_PORT="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --name) CONTAINER_NAME="$2"; shift 2 ;;
    --load) IMAGE_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

engine() {
  if [[ -n "${CONTAINER_ENGINE:-}" ]]; then echo "$CONTAINER_ENGINE"; return; fi
  # On RHEL "docker" is often podman under another name (podman-docker); it needs podman's user options.
  if command -v docker >/dev/null 2>&1 && docker --version 2>&1 | grep -qi podman; then echo podman; return; fi
  if command -v docker >/dev/null 2>&1; then echo docker; return; fi
  if command -v podman >/dev/null 2>&1; then echo podman; return; fi
  echo "Neither docker nor podman is installed." >&2
  exit 1
}
ENGINE="$(engine)"

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "Note: this host is $(uname -m); the image is built for x86_64 (linux/amd64)." >&2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "The .env file was not found: $ENV_FILE" >&2
  echo "Copy .env.example there and fill it in, or pass --env-file <path>." >&2
  exit 1
fi
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd -P)/$(basename "$ENV_FILE")"

case "$DB_NAME" in
  */*|"") echo "--db-name is a file name inside the data folder, e.g. solutioncrafter.duckdb" >&2; exit 1 ;;
  *.duckdb) ;;
  *) echo "The database file name should end in .duckdb: $DB_NAME" >&2; exit 1 ;;
esac
mkdir -p "$DATA_DIR"
DATA_DIR="$(cd "$DATA_DIR" && pwd -P)"

# The image id inside a saved .tar.gz (docker save and podman save both write manifest.json).
saved_image_id() {
  { gunzip -c "$1" | tar -xOf - manifest.json 2>/dev/null || true; } \
    | grep -o '"Config":"[^"]*"' | head -n 1 | sed -e 's/"Config":"//' -e 's/"$//' -e 's#.*/##' -e 's/\.json$//'
}
loaded_image_id() {
  "$ENGINE" image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null | sed 's/^sha256://' || true
}

if [[ -n "$IMAGE_FILE" && ! -f "$IMAGE_FILE" ]]; then
  echo "Saved image not found: $IMAGE_FILE" >&2
  exit 1
fi
if [[ -z "$IMAGE_FILE" ]]; then
  for candidate in "$ROOT"/dist/specforge-*.tar.gz "$ROOT"/specforge-*.tar.gz "$(dirname "${BASH_SOURCE[0]}")"/specforge-*.tar.gz; do
    if [[ -f "$candidate" ]]; then IMAGE_FILE="$candidate"; break; fi
  done
fi
# Load the saved image unless exactly that image is already loaded. Without this, an older image with the same
# tag would keep running after a newer .tar.gz was copied over.
if [[ -n "$IMAGE_FILE" ]]; then
  echo "Checking $IMAGE_FILE ..."
  saved="$(saved_image_id "$IMAGE_FILE")"
  loaded="$(loaded_image_id)"
  if [[ -z "$saved" || "$saved" != "$loaded" ]]; then
    echo "Loading image from $IMAGE_FILE ..."
    gunzip -c "$IMAGE_FILE" | "$ENGINE" load
    if [[ -n "$saved" && "$(loaded_image_id)" != "$saved" ]]; then
      # The saved image was tagged differently; point the tag used here at it.
      "$ENGINE" tag "$saved" "$IMAGE"
    fi
  else
    echo "That image is already loaded."
  fi
fi
if ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not found. Build it with ./scripts/docker-build.sh, or pass --load <saved image .tar.gz>." >&2
  exit 1
fi
revision="$("$ENGINE" image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" 2>/dev/null || true)"
[[ "$revision" == "<no value>" ]] && revision=""
created="$("$ENGINE" image inspect -f '{{.Created}}' "$IMAGE" 2>/dev/null || true)"
image_id="$(loaded_image_id)"
echo "Image: $IMAGE  id ${image_id:0:12}  built ${created%%.*}  commit ${revision:-unknown}"

# An old container with this name (running or stopped) is replaced.
if "$ENGINE" container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Replacing the existing $CONTAINER_NAME container ..."
  "$ENGINE" stop --time 30 "$CONTAINER_NAME" >/dev/null 2>&1 || true
  "$ENGINE" rm "$CONTAINER_NAME" >/dev/null
fi

# On RHEL with SELinux enforcing, mounted host paths need a label the container may read.
label=""
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce 2>/dev/null)" != "Disabled" ]]; then
  label=",z"
fi

# Files written to the database folder belong to the user who runs this script.
user_args=(--user "$(id -u):$(id -g)")
if [[ "$ENGINE" == "podman" && "$(id -u)" != "0" ]]; then
  user_args=(--userns=keep-id)
fi

"$ENGINE" run --detach \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --publish "$HOST_PORT:8000" \
  "${user_args[@]}" \
  --env DATA_DIR=/data \
  --env "DUCKDB_PATH=/data/$DB_NAME" \
  --volume "$ENV_FILE:/app/.env:ro$label" \
  --volume "$DATA_DIR:/data:rw$label" \
  "$IMAGE" >/dev/null

echo "Started $CONTAINER_NAME ($IMAGE, commit ${revision:-unknown})"
echo "  data:      $DATA_DIR  (database $DB_NAME, uploads/)"
echo "  .env:      $ENV_FILE  (read-only)"

printf "Waiting for SpecForge to answer"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$HOST_PORT/api/health" >/dev/null 2>&1; then
    echo
    echo "SpecForge is up: http://$(hostname -f 2>/dev/null || hostname):$HOST_PORT"
    echo "Logs: $ENGINE logs -f $CONTAINER_NAME    Stop: ./scripts/docker-stop.sh"
    exit 0
  fi
  # A crash shows as stopped, or as restarted (the restart policy brings it straight back), so stop waiting.
  state="$("$ENGINE" container inspect -f '{{.State.Status}} {{.RestartCount}}' "$CONTAINER_NAME" 2>/dev/null || echo "missing 0")"
  if [[ "${state%% *}" != "running" || "${state##* }" != "0" ]]; then
    echo
    echo "SpecForge stopped while starting (state: ${state%% *}, restarts: ${state##* })." >&2
    break
  fi
  printf "."
  sleep 2
done
echo
echo "SpecForge did not come up. Last log lines:" >&2
"$ENGINE" logs --tail 40 "$CONTAINER_NAME" >&2 || true
# Do not leave it crashing and restarting in a loop.
"$ENGINE" stop --time 5 "$CONTAINER_NAME" >/dev/null 2>&1 || true
echo >&2
echo "The container was stopped. Fix the error above, then run this script again." >&2
exit 1

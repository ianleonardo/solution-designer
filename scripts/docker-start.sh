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
# If the image is not loaded yet, a saved image (specforge-*.tar.gz in --load, dist/ or beside this script) is loaded.
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

# Load a saved image when this one is not loaded yet.
if [[ -n "$IMAGE_FILE" ]] || ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1; then
  if [[ -z "$IMAGE_FILE" ]]; then
    for candidate in "$ROOT"/dist/specforge-*.tar.gz "$ROOT"/specforge-*.tar.gz "$(dirname "${BASH_SOURCE[0]}")"/specforge-*.tar.gz; do
      if [[ -f "$candidate" ]]; then IMAGE_FILE="$candidate"; break; fi
    done
  fi
  if [[ -n "$IMAGE_FILE" ]]; then
    echo "Loading image from $IMAGE_FILE ..."
    gunzip -c "$IMAGE_FILE" | "$ENGINE" load
  fi
fi
if ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not found. Build it with ./scripts/docker-build.sh, or pass --load <saved image .tar.gz>." >&2
  exit 1
fi

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

echo "Started $CONTAINER_NAME ($IMAGE)"
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
  if [[ "$("$ENGINE" container inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" != "true" ]]; then
    break
  fi
  printf "."
  sleep 2
done
echo
echo "SpecForge did not come up. Last log lines:" >&2
"$ENGINE" logs --tail 40 "$CONTAINER_NAME" >&2 || true
exit 1

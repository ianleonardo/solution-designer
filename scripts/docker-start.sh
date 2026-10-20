#!/usr/bin/env bash
# Start SpecForge in a container. The .env file and the DuckDB database stay on the host.
#
# Set the paths below, or pass them each time:
#   ./scripts/docker-start.sh --env-file /opt/specforge/.env --db /opt/specforge/data/specforge.duckdb --port 8080
#
# The folder holding the DuckDB file is mounted into the container, so the database, its .wal file and the
# uploaded files (in an "uploads" folder beside it) all stay in that folder. The .env file is mounted read-only.
# Uses docker, or podman when docker is not installed. Set CONTAINER_ENGINE to choose.

set -euo pipefail

# ---- settings -------------------------------------------------------------------------------------------------
ENV_FILE="${ENV_FILE:-/opt/specforge/.env}"                          # the .env file to use
DB_FILE="${DB_FILE:-/opt/specforge/data/solutioncrafter.duckdb}"    # the DuckDB file (created when missing)
HOST_PORT="${HOST_PORT:-8080}"                                       # open http://<server>:HOST_PORT
IMAGE="${IMAGE:-specforge:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-specforge}"
# ----------------------------------------------------------------------------------------------------------------

usage() { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --db) DB_FILE="$2"; shift 2 ;;
    --port) HOST_PORT="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --name) CONTAINER_NAME="$2"; shift 2 ;;
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

absolute() { (cd "$(dirname "$1")" && echo "$(pwd -P)/$(basename "$1")"); }

if [[ ! -f "$ENV_FILE" ]]; then
  echo "The .env file was not found: $ENV_FILE" >&2
  echo "Copy .env.example there and fill it in, or pass --env-file <path>." >&2
  exit 1
fi
ENV_FILE="$(absolute "$ENV_FILE")"

case "$DB_FILE" in
  *.duckdb) ;;
  *) echo "The database path should end in .duckdb: $DB_FILE" >&2; exit 1 ;;
esac
DB_DIR="$(dirname "$DB_FILE")"
mkdir -p "$DB_DIR"
DB_FILE="$(absolute "$DB_FILE")"
DB_DIR="$(dirname "$DB_FILE")"
DB_NAME="$(basename "$DB_FILE")"

if ! "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Image $IMAGE not found. Build it with ./scripts/docker-build.sh, or load a saved one with: $ENGINE load -i <file>" >&2
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
  --volume "$DB_DIR:/data:rw$label" \
  "$IMAGE" >/dev/null

echo "Started $CONTAINER_NAME ($IMAGE)"
echo "  .env:      $ENV_FILE"
echo "  database:  $DB_FILE"
echo "  uploads:   $DB_DIR/uploads"

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

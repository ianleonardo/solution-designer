#!/usr/bin/env bash
# Stop the SpecForge container and remove it. The .env file, database and uploads on the host are kept.
#
#   ./scripts/docker-stop.sh                 stop the "specforge" container
#   ./scripts/docker-stop.sh --name other    stop another one started with --name
#
# The app gets 30 seconds to finish requests and close the database cleanly.
# Uses docker, or podman when docker is not installed. Set CONTAINER_ENGINE to choose.

set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-specforge}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) CONTAINER_NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
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

if ! "$ENGINE" container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "No container named $CONTAINER_NAME."
  exit 0
fi

echo "Stopping $CONTAINER_NAME ..."
"$ENGINE" stop --time 30 "$CONTAINER_NAME" >/dev/null
"$ENGINE" rm "$CONTAINER_NAME" >/dev/null
echo "Stopped. Data is kept on the host; start again with ./scripts/docker-start.sh"

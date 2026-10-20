#!/usr/bin/env bash
# Build the SpecForge image for RHEL servers (linux/amd64).
#
#   ./scripts/docker-build.sh                      build specforge:latest
#   ./scripts/docker-build.sh --tag specforge:1.4  choose the tag
#   ./scripts/docker-build.sh --save               also write dist/specforge-latest.tar.gz to copy to a server
#   ./scripts/docker-build.sh --platform linux/arm64
#
# Behind a proxy or a private mirror, export HTTP_PROXY / HTTPS_PROXY / NO_PROXY, PIP_INDEX_URL (and PIP_TRUSTED_HOST)
# or NPM_CONFIG_REGISTRY first; they are passed to the build.
# Uses docker, or podman when docker is not installed. Set CONTAINER_ENGINE to choose.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-specforge:latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
SAVE=""

usage() { sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) IMAGE="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --save) SAVE="${2:-}"; if [[ -n "$SAVE" && "$SAVE" != --* ]]; then shift 2; else SAVE="auto"; shift; fi ;;
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

build_args=()
for name in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy PIP_INDEX_URL PIP_TRUSTED_HOST NPM_CONFIG_REGISTRY; do
  if [[ -n "${!name:-}" ]]; then build_args+=(--build-arg "$name=${!name}"); fi
done

echo "Building $IMAGE for $PLATFORM with $ENGINE ..."
"$ENGINE" build \
  --platform "$PLATFORM" \
  --file "$ROOT/Dockerfile" \
  --tag "$IMAGE" \
  ${build_args[@]+"${build_args[@]}"} \
  "$ROOT"

if [[ -n "$SAVE" ]]; then
  if [[ "$SAVE" == "auto" ]]; then
    mkdir -p "$ROOT/dist"
    SAVE="$ROOT/dist/$(echo "$IMAGE" | tr '/:' '--').tar.gz"
  fi
  echo "Saving $IMAGE to $SAVE ..."
  "$ENGINE" save "$IMAGE" | gzip > "$SAVE"
  echo "Copy it to the server and load it with:  docker load -i $(basename "$SAVE")   (or: podman load -i ...)"
fi

echo "Done. Start it with: ./scripts/docker-start.sh"

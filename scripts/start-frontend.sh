#!/usr/bin/env bash
# Start the frontend. Prints localhost and this machine's network address.
# Run from anywhere: ./scripts/start-frontend.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=5173

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Frontend dependencies not found. From the repository root, run: npm ci" >&2
  exit 1
fi

# First usable IPv4 on this machine. macOS uses ipconfig; Linux uses ip or hostname.
local_ip() {
  local ip="" iface
  if command -v ipconfig >/dev/null 2>&1; then
    for iface in en0 en1 en2; do
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      if [[ -n "$ip" ]]; then
        printf '%s\n' "$ip"
        return 0
      fi
    done
  fi
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}' || true)"
    if [[ -n "$ip" ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi
  if hostname -I >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [[ -n "$ip" ]]; then
      printf '%s\n' "$ip"
      return 0
    fi
  fi
  return 1
}

cd "$ROOT"
echo "Frontend on this machine:    http://localhost:${PORT}"
if ip="$(local_ip)"; then
  echo "Frontend on the local network: http://${ip}:${PORT}"
else
  echo "Local network address: not found."
fi
exec npm run dev --workspace frontend -- --host 0.0.0.0 --port "$PORT"

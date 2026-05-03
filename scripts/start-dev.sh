#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3000}"
HEALTH_URL="http://localhost:${PORT}/api/health"
MAX_WAIT=30
CHECK_INTERVAL=1

# Kill any existing process on the target port
existing_pid=$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)
if [ -n "${existing_pid:-}" ]; then
  echo "Killing existing process on port ${PORT} (PID: ${existing_pid})"
  kill -9 $existing_pid 2>/dev/null || true
  sleep 1
fi

# Start the dev server in the background
echo "Starting dev server on port ${PORT}..."
bun run dev &
DEV_PID=$!

# Poll health endpoint until ready
echo "Waiting for server to become healthy..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  if curl -sf -o /dev/null "$HEALTH_URL" 2>/dev/null; then
    echo "Server is healthy at ${HEALTH_URL}"
    echo "PID: ${DEV_PID}"
    exit 0
  fi
  sleep $CHECK_INTERVAL
  elapsed=$((elapsed + CHECK_INTERVAL))
done

echo "ERROR: Server did not become healthy within ${MAX_WAIT}s"
kill $DEV_PID 2>/dev/null || true
exit 1

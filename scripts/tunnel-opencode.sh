#!/bin/bash
# Tunnel script for OpenCode web interface with password protection
# Run from A-Guy project root: pnpm tunnel:ocode

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

PORT=3003
USERNAME="admin"
PASSWORD="As121212"

echo "🚀 Starting OpenCode tunnel on port $PORT"
echo "🔒 Protected with: $USERNAME / ********"
echo ""

# Check if OpenCode is running on this port
if ! lsof -i :$PORT -sTCP:LISTEN > /dev/null 2>&1; then
    echo "⚠️  Starting OpenCode on port $PORT..."
    opencode web --port $PORT &
    sleep 5
fi

# Start ngrok with basic auth protection
ngrok http $PORT --basic-auth "$USERNAME:$PASSWORD"

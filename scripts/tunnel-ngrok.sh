#!/bin/bash
# Tunnel script for ngrok with basic auth protection
# Run from A-Guy project root: bash scripts/tunnel-ngrok.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

PORT=${1:-3000}
USERNAME="admin"
PASSWORD="As121212"

echo "🚀 Starting ngrok tunnel on port $PORT"
echo "🔒 Basic auth enabled: $USERNAME / **********"
echo ""

# Check if dev server is running
if ! lsof -i :$PORT > /dev/null 2>&1; then
    echo "⚠️  Warning: Nothing running on port $PORT"
    echo "   Make sure your dev server is running: pnpm dev"
    echo ""
fi

# Start ngrok with basic auth
ngrok http $PORT \
    --basic-auth "$USERNAME:$PASSWORD" \
    --log stdout

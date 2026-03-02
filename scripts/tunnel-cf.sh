#!/bin/bash
# Cloudflare Tunnel setup and run script
# Run from A-Guy project root: bash scripts/tunnel-cf.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Configuration
TUNNEL_NAME="a-guy-dev"
PORT=${1:-3000}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Cloudflare Tunnel Setup${NC}"
echo "================================"
echo ""

# Check if dev server is running
if ! lsof -i :$PORT > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Warning: Nothing running on port $PORT${NC}"
    echo "   Make sure your dev server is running: pnpm dev"
    echo ""
fi

# Check if logged in to Cloudflare
echo "📋 Checking Cloudflare authentication..."
if ! cloudflared tunnel list >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Not logged in to Cloudflare${NC}"
    echo "   Please run: cloudflared login"
    echo "   This will open a browser to authenticate with Cloudflare."
    echo ""
    
    # Try to open login page
    cloudflared login
    
    echo ""
    echo -e "${YELLOW}After logging in, run this script again.${NC}"
    exit 1
fi

# Check if tunnel exists
echo "📋 Checking for existing tunnel '$TUNNEL_NAME'..."
TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}' | head -1)

if [ -z "$TUNNEL_ID" ]; then
    echo "🔧 Creating new tunnel: $TUNNEL_NAME"
    cloudflared tunnel create $TUNNEL_NAME
    TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}' | head -1)
    
    if [ -z "$TUNNEL_ID" ]; then
        echo -e "${RED}❌ Failed to create tunnel${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Tunnel created: $TUNNEL_ID${NC}"
else
    echo -e "${GREEN}✅ Using existing tunnel: $TUNNEL_ID${NC}"
fi

# Create config directory if needed
mkdir -p ~/.cloudflared

# Create or update tunnel config
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: ~/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $TUNNEL_NAME.loca.lt
    service: http://localhost:$PORT
  - service: http_status:404
EOF

echo ""
echo "📋 Tunnel configuration:"
echo "   Tunnel ID: $TUNNEL_ID"
echo "   Local port: $PORT"
echo ""

# Check if subdomain is available (loca.lt is a free DNS service for tunnels)
echo "🌐 Starting tunnel..."
echo "   Your URL will be: https://$TUNNEL_NAME.loca.lt"
echo ""

# Run the tunnel
cloudflared tunnel --url http://localhost:$PORT

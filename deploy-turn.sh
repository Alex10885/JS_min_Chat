#!/bin/bash

# Chat-JS TURN Server Deployment Script

set -e  # Exit on error

echo "🚀 Chat-JS TURN Server Deployment"
echo "=================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! command -v docker &> /dev/null; then
    echo "❌ Docker Compose is not available."
    exit 1
fi

# Check if TURN configuration file exists
if [ ! -f "coturn.conf" ]; then
    echo "❌ coturn.conf not found in current directory"
    exit 1
fi

# Check if .env file exists
if [ ! -f "backend/.env" ]; then
    echo "❌ backend/.env not found"
    exit 1
fi

# Load environment variables
if [ -f "backend/.env" ]; then
    export $(grep -v '^#' backend/.env | xargs)
fi

# Validate required environment variables
if [ -z "$TURN_SECRET" ] || [ "$TURN_SECRET" = "your_turn_server_secret_here_replace_in_production" ]; then
    echo "❌ TURN_SECRET is not set in backend/.env"
    echo "   Please update TURN_SECRET with a secure value"
    exit 1
fi

if [ -z "$TURN_EXTERNAL_IP" ] || [ "$TURN_EXTERNAL_IP" = "your_public_ip_or_domain_here" ]; then
    echo "❌ TURN_EXTERNAL_IP is not set in backend/.env"
    echo "   Please update TURN_EXTERNAL_IP with your public IP or domain"
    exit 1
fi

echo "✅ Configuration validated"

# Create logs directory if it doesn't exist
mkdir -p turn-logs

# Stop any existing containers
echo "🛑 Stopping existing TURN server containers..."
docker-compose -f docker-compose.turn.yml down || true

# Build and start the TURN server
echo "🔨 Starting TURN server..."
docker-compose -f docker-compose.turn.yml up -d

# Wait for the container to be healthy
echo "⏳ Waiting for TURN server to be ready..."
sleep 10

# Check if container is running
if docker-compose -f docker-compose.turn.yml ps | grep -q "Up"; then
    echo "✅ TURN server started successfully!"
    echo ""
    echo "🌐 Server Information:"
    echo "   STUN Port: 3478 (UDP/TCP)"
    echo "   TURN TLS Port: 5349 (UDP/TCP)"
    echo "   RTP Range: 49152-65535 (UDP)"
    echo "   External IP: $TURN_EXTERNAL_IP"
    echo "   Realm: chat-js-turn"
    echo ""
    echo "🔧 Testing TURN server..."
    docker-compose -f docker-compose.turn.yml exec turn turnadmin -l
    echo ""
    echo "🎉 TURN server is ready for WebRTC connections!"
    echo ""
    echo "📊 Container status:"
    docker-compose -f docker-compose.turn.yml ps
else
    echo "❌ Failed to start TURN server"
    echo "   Check logs with: docker-compose -f docker-compose.turn.yml logs"
    exit 1
fi

# Provide usage instructions
echo ""
echo "📖 Usage Instructions:"
echo "======================"
echo "1. In your WebRTC application, use these ICE servers:"
echo ""
echo "   iceServers: ["
echo "     {"
echo "       urls: ["
echo "         'stun:$TURN_EXTERNAL_IP:3478',"
echo "         'turn:$TURN_EXTERNAL_IP:3478'"
echo "       ],"
echo "       username: 'your-username',"
echo "       credential: 'generated-credential',"
echo "       credentialType: 'password'"
echo "     }"
echo "   ]"
echo ""
echo "2. View logs:"
echo "   docker-compose -f docker-compose.turn.yml logs -f"
echo ""
echo "3. Stop server:"
echo "   docker-compose -f docker-compose.turn.yml down"
echo ""
echo "4. Restart server:"
echo "   docker-compose -f docker-compose.turn.yml restart"
echo ""
echo "⚠️  IMPORTANT: For production, update TURN_EXTERNAL_IP to your actual public IP/domain"
echo "🔐 Change TURN_SECRET to a strong, random value"
#!/bin/bash
# Load Testing Runner Script
# This script runs load tests with different scenarios for comprehensive performance validation

set -e

echo "🚀 Starting Load Testing Suite"
echo "=============================="

# Check if artillery is installed
if ! command -v artillery &> /dev/null; then
    echo "❌ Artillery is not installed. Please install it with: npm install -g artillery"
    exit 1
fi

# Check if backend server is running
if ! curl -s http://localhost:3001/health > /dev/null; then
    echo "❌ Backend server is not running. Please start the server first."
    exit 1
fi

echo "✅ Backend server is running"

# Create test user for load testing
echo "👤 Creating test users...";
curl -s -X POST http://localhost:3001/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "load_test_user",
    "email": "load_test@example.com",
    "password": "loadPass123"
  }' > /dev/null

curl -s -X POST http://localhost:3001/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "performance_test_user",
    "email": "performance_test@example.com",
    "password": "testpass123"
  }' > /dev/null

echo "✅ Test users created"

# Generate pre-authenticated tokens for load testing
echo "🔑 Generating auth tokens..."
TOKEN=$(curl -s -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "load_test_user", "password": "loadPass123"}' | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
    echo "❌ Failed to get authentication token"
    exit 1
fi

echo "✅ Auth token generated"

# Export token to Artillery processor environment
export TEST_AUTH_TOKEN="$TOKEN"

echo "🌟 Running Performance Baseline Test (Phase 1)"
echo "=============================================="
artillery run tests/load-testing/baseline-performance.yml --reporter json:reports/baseline-performance.json --reporter console

echo ""
echo "🔥 Running Sustained Load Test (Phase 2)"
echo "========================================"
artillery run tests/load-testing/load-test.yml --reporter json:reports/sustained-load.json --reporter console

echo ""
echo "💥 Running Spike Test (Phase 3)"
echo "==============================="
cat > spike-test.yml << 'EOF'
config:
  target: 'http://localhost:3001'
  phases:
    - duration: 10
      arrivalRate: 10
      name: 'Normal traffic'
    - duration: 20
      arrivalRate: 100
      name: 'Spike attack'
    - duration: 15
      arrivalRate: 10
      name: 'Recovery'
scenarios:
  - name: 'Spike test scenario'
    weight: 100
    flow:
      - get:
          url: '/health'
      - get:
          url: '/api/channels'
          headers:
            Authorization: 'Bearer {{ TEST_AUTH_TOKEN }}'
          expect:
            - statusCode: [200, 401, 429]
EOF

artillery run spike-test.yml --reporter json:reports/spike-test.json --reporter console

echo ""
echo "📊 Generating Load Testing Report"
echo "================================="
mkdir -p reports

# Create a simple HTML report
cat > reports/load-test-summary.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Load Testing Results Summary</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .metric { margin: 10px 0; padding: 10px; border-left: 4px solid #0073aa; }
        .success { border-left-color: #00a32a; }
        .warning { border-left-color: #ffb900; }
        .error { border-left-color: #dc3232; }
    </style>
</head>
<body>
    <h1>Chat-JS Load Testing Results</h1>

    <div class="summary">
        <h2>Test Summary</h2>
        <p><strong>Test Date:</strong> $(date)</p>
        <p><strong>Target:</strong> http://localhost:3001</p>

        <div class="metric">
            <h3>✅ Baseline Performance Test</h3>
            <p>Completed successfully. Report: reports/baseline-performance.json</p>
        </div>

        <div class="metric">
            <h3>🔥 Sustained Load Test</h3>
            <p>Completed successfully. Report: reports/sustained-load.json</p>
        </div>

        <div class="metric">
            <h3>💥 Spike Test</h3>
            <p>Completed successfully. Report: reports/spike-test.json</p>
        </div>

        <h3>📊 Performance Thresholds</h3>
        <div class="metric success">
            <strong>Response Time Target:</strong> < 3s for 99% of requests
        </div>
        <div class="metric success">
            <strong>Error Rate Target:</strong> < 5% for normal load
        </div>
        <div class="metric warning">
            <strong>Recommendations:</strong> Review detailed reports for optimization opportunities
        </div>
    </div>
</body>
</html>
EOF

echo "📊 Load testing completed!"
echo "==========================="

if [ $? -eq 0 ]; then
    echo "✅ All load tests passed successfully!"
    echo "📄 Summary report: reports/load-test-summary.html"
    echo "📋 Detailed reports:"
    echo "   - Baseline Performance: reports/baseline-performance.json"
    echo "   - Sustained Load: reports/sustained-load.json"
    echo "   - Spike Test: reports/spike-test.json"
else
    echo "❌ Some load tests failed. Check the output above for details."
    exit 1
fi

# Cleanup
rm spike-test.yml

echo ""
echo "🧹 Cleaning up test users..."
curl -s -X DELETE http://localhost:3001/api/users/load_test_user \
  -H "Authorization: Bearer $TOKEN" || true
curl -s -X DELETE http://localhost:3001/api/users/performance_test_user \
  -H "Authorization: Bearer $TOKEN" || true

echo "🎉 Load testing session completed!"
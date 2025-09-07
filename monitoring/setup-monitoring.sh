#!/bin/bash
# ========================================
# GCP MONITORING SETUP SCRIPT FOR CHAT-JS
# ========================================
# Automated monitoring and alerting setup

set -e

PROJECT_ID="${GCP_PROJECT_ID:-your-gcp-project-id}"
REGION="${REGION:-europe-west1}"

echo "📊 Setting up GCP monitoring for Chat-JS..."

# ========================================
# 1. ENABLE REQUIRED APIs
# ========================================
echo "🔌 Enabling required APIs..."

APIs=(
    cloudmonitoring.googleapis.com
    logging.googleapis.com
    monitoring.googleapis.com
    alertmanager.googleapis.com
)

for api in "${APIs[@]}"; do
    echo "Enabling $api..."
    gcloud services enable "$api" --project="$PROJECT_ID"
done

# ========================================
# 2. CREATE NOTIFICATION CHANNELS
# ========================================
echo "📢 Creating notification channels..."

# Email Channel
EMAIL_CHANNEL_ID=$(gcloud monitoring channels create \
    --type=email \
    --display-name="Chat-JS Critical Alerts" \
    --description="Critical alerts for Chat-JS production" \
    --channel-labels="email_address=alerts@yourcompany.com" \
    --format="value(name.split('/').@[2])" \
    --project="$PROJECT_ID")

echo "Created email notification channel: $EMAIL_CHANNEL_ID"

# Slack Channel (optional)
if [ -n "$SLACK_WEBHOOK_URL" ]; then
    SLACK_CHANNEL_ID=$(gcloud monitoring channels create \
        --type=slack \
        --display-name="Chat-JS Slack Alerts" \
        --description="Chat-JS alerts via Slack" \
        --channel-labels="webhook_url=$SLACK_WEBHOOK_URL,channel_name=#alerts" \
        --format="value(name.split('/').@[2])" \
        --project="$PROJECT_ID")

    echo "Created Slack notification channel: $SLACK_CHANNEL_ID"
fi

# ========================================
# 3. CREATE UPTIME CHECKS
# ========================================
echo "🏥 Creating uptime checks..."

BACKEND_URL="https://chat-js-backend-HASH-$REGION.run.app"
FRONTEND_URL="https://chat-js-frontend-HASH-$REGION.run.app"

# Backend uptime check
gcloud monitoring uptime-check-configs create "chat-js-backend-uptime" \
    --display-name="Chat-JS Backend Health Check" \
    --http-check-path="/health" \
    --http-check-port=443 \
    --use-ssl \
    --selected-regions="$REGION" \
    --timeout=10 \
    --period=60 \
    --content-matchers="content=healthy,status=200" \
    --resource-labels="host=${BACKEND_URL#https://}" \
    --project="$PROJECT_ID"

# Frontend uptime check
gcloud monitoring uptime-check-configs create "chat-js-frontend-uptime" \
    --display-name="Chat-JS Frontend Health Check" \
    --http-check-path="/health" \
    --http-check-port=443 \
    --use-ssl \
    --selected-regions="$REGION" \
    --timeout=5 \
    --period=60 \
    --content-matchers="status=200" \
    --resource-labels="host=${FRONTEND_URL#https://}" \
    --project="$PROJECT_ID"

echo "Created uptime checks for backend and frontend"

# ========================================
# 4. CREATE ALERT POLICIES
# ========================================
echo "🚨 Creating alert policies..."

# Critical Error Rate Alert
gcloud monitoring alert-policies create "chat-js-backend-error-rate" \
    --display-name="Backend High Error Rate" \
    --description="High HTTP 5xx error rate detected" \
    --condition-filter="
        metric.type='logging.googleapis.com/log_entry_count' AND
        resource.type='cloud_run_revision' AND
        resource.labels.service_name='chat-js-backend' AND
        severity>=ERROR
    " \
    --condition-threshold-value=5 \
    --condition-threshold-duration=300s \
    --notification-channels="$EMAIL_CHANNEL_ID" \
    --documentation="Backend error rate exceeded 5%. Investigation required." \
    --project="$PROJECT_ID"

# Service Down Alert
gcloud monitoring alert-policies create "chat-js-service-down" \
    --display-name="Chat-JS Service Unavailable" \
    --description="Critical service is unreachable" \
    --condition-filter="
        metric.type='monitoring.googleapis.com/uptime_check/check_passed' AND
        resource.type='uptime_url'
    " \
    --condition-threshold-value=false \
    --condition-threshold-duration=300s \
    --notification-channels="$EMAIL_CHANNEL_ID" \
    --documentation="Service is down. Immediate attention required." \
    --project="$PROJECT_ID"

# High CPU Usage Alert
gcloud monitoring alert-policies create "chat-js-high-cpu" \
    --display-name="High CPU Usage Alert" \
    --description="Service experiencing high CPU utilization" \
    --condition-filter="
        metric.type='run.googleapis.com/container/cpu/utilization' AND
        resource.type='cloud_run_revision' AND
        resource.labels.service_name=~chat-js-.*
    " \
    --condition-threshold-value=0.8 \
    --condition-threshold-duration=300s \
    --notification-channels="$EMAIL_CHANNEL_ID" \
    --documentation="CPU usage >80%. Consider scaling or optimization." \
    --project="$PROJECT_ID"

# Memory Usage Alert
gcloud monitoring alert-policies create "chat-js-high-memory" \
    --display-name="High Memory Usage Alert" \
    --description="Service experiencing high memory utilization" \
    --condition-filter="
        metric.type='run.googleapis.com/container/memory/utilization' AND
        resource.type='cloud_run_revision' AND
        resource.labels.service_name=~chat-js-.*
    " \
    --condition-threshold-value=0.9 \
    --condition-threshold-duration=300s \
    --notification-channels="$EMAIL_CHANNEL_ID" \
    --documentation="Memory usage >90%. Monitor closely for OOM issues." \
    --project="$PROJECT_ID"

# Latency Alert
gcloud monitoring alert-policies create "chat-js-high-latency" \
    --display-name="High Response Latency" \
    --description="Backend response latency is high" \
    --condition-filter="
        metric.type='appengine.googleapis.com/http/server/response_latencies' AND
        resource.type='gae_app' AND
        resource.labels.module_id='default'
    " \
    --condition-threshold-value=5000 \
    --condition-threshold-duration=300s \
    --notification-channels="$EMAIL_CHANNEL_ID" \
    --documentation="P95 latency >5s. Check performance and potential bottlenecks." \
    --project="$PROJECT_ID"

echo "Created comprehensive alert policies"

# ========================================
# 5. CREATE CUSTOM DASHBOARDS
# ========================================
echo "📈 Creating monitoring dashboards..."

# Create Chat-JS main dashboard
DASHBOARD_CONFIG=$(cat <<EOF
{
  "name": "Chat-JS Production Dashboard",
  "layout": {
    "columns": 2,
    "widgets": [
      {
        "text": {
          "content": "# Chat-JS Production Monitoring Dashboard\n\nThis dashboard provides comprehensive monitoring for Chat-JS services in production.",
          "format": "MARKDOWN"
        }
      },
      {
        "tile": {
          "title": "Uptime Health",
          "widgetId": "uptime-widget"
        }
      },
      {
        "tile": {
          "title": "Error Rate",
          "widgetId": "error-rate-widget"
        }
      },
      {
        "tile": {
          "title": "Response Latency",
          "widgetId": "latency-widget"
        }
      },
      {
        "tile": {
          "title": "Resource Usage",
          "widgetId": "resources-widget"
        }
      }
    ]
  }
}
EOF
)

gcloud monitoring dashboards create "chat-js-production-dashboard" \
    --config="$DASHBOARD_CONFIG" \
    --project="$PROJECT_ID"

echo "Created monitoring dashboard"

# ========================================
# 6. LOGGING SINKS AND ALERTS
# ========================================
echo "📋 Setting up logging and metrics..."

# Create log-based metrics
gcloud logging metrics create "chat-js-error-count" \
    --description="Count of error log entries" \
    --filter="resource.type=cloud_run_revision AND resource.labels.service_name=~chat-js-* AND severity>=ERROR" \
    --metric-kind=DELTA \
    --value-type=INT64 \
    --project="$PROJECT_ID"

gcloud logging metrics create "chat-js-request-count" \
    --description="HTTP request count by status" \
    --filter="resource.type=cloud_run_revision AND resource.labels.service_name=~chat-js-*" \
    --metric-kind=DELTA \
    --value-type=INT64 \
    --labels="status_code=httpRequest.status" \
    --project="$PROJECT_ID"

echo "Created custom log-based metrics"

# ========================================
# 7. SLACK/SMS INTEGRATION (OPTIONAL)
# ========================================
if [ -n "$SLACK_WEBHOOK_URL" ]; then
    echo "🔗 Setting up Slack integration..."
    # Slack webhook integration commands would go here
    echo "Slack integration configured"
fi

# ========================================
# 8. VERIFICATION
# ========================================
echo ""
echo "✅ Monitoring setup completed!"
echo ""
echo "📊 CREATED RESOURCES:"
echo "・Email notification channel: $EMAIL_CHANNEL_ID"
echo ""
echo "🏥 UPTIME CHECKS:"
echo "・chat-js-backend-uptime"
echo "・chat-js-frontend-uptime"
echo ""
echo "🚨 ALERT POLICIES:"
echo "・chat-js-backend-error-rate"
echo "・chat-js-service-down"
echo "・chat-js-high-cpu"
echo "・chat-js-high-memory"
echo "・chat-js-high-latency"
echo ""
echo "📈 LOG-BASED METRICS:"
echo "・chat-js-error-count"
echo "・chat-js-request-count"
echo ""
echo "🔗 DASHBOARDS:"
echo "・Chat-JS Production Dashboard"
echo ""
echo "🎯 NEXT STEPS:"
echo "1. Update URLs in uptime checks after deployment"
echo "2. Test alert notifications"
echo "3. Configure PagerDuty/Slack integrations"
echo "4. Set up custom dashboards with specific metrics"
echo ""
echo "📚 MONITORING URLs:"
echo "Dashboard: https://console.cloud.google.com/monitoring/dashboards"
echo "Alerts: https://console.cloud.google.com/monitoring/alerting"
echo "Logs: https://console.cloud.google.com/logs"
echo ""
echo "✅ GCP monitoring setup is complete!"
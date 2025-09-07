#!/bin/bash
# ========================================
# PRODUCTION SECURITY SETUP SCRIPT
# ========================================
# Automated security hardening for Chat-JS

set -e

PROJECT_ID="${GCP_PROJECT_ID:-your-gcp-project-id}"
REGION="${REGION:-europe-west1}"
BACKEND_URL="https://chat-js-backend-HASH-$REGION.run.app"
FRONTEND_URL="https://chat-js-frontend-HASH-$REGION.run.app"

echo "🔒 Setting up production security for Chat-JS..."

# ========================================
# 1. CLOUD ARMOR SECURITY POLICY
# ========================================
echo "🛡️ Creating Cloud Armor security policy..."

gcloud compute security-policies create chat-js-production-security-policy \
    --description="Comprehensive WAF for Chat-JS production" \
    --project="$PROJECT_ID"

echo "✅ Created security policy"

# Enable pre-configured WAF rules
echo "🔧 Configuring WAF rules..."

# SQL Injection Protection
gcloud compute security-policies rules create 100 \
    --security-policy=chat-js-production-security-policy \
    --action=deny-403 \
    --description="Block SQL injection" \
    --src-ip-ranges="*" \
    --expression="evaluatePreconfiguredWaf('sqli-stable')" \
    --project="$PROJECT_ID"

# XSS Protection
gcloud compute security-policies rules create 200 \
    --security-policy=chat-js-production-security-policy \
    --action=deny-403 \
    --description="Block XSS attacks" \
    --src-ip-ranges="*" \
    --expression="evaluatePreconfiguredWaf('xss-stable')" \
    --project="$PROJECT_ID"

# Path Traversal Protection
gcloud compute security-policies rules create 300 \
    --security-policy=chat-js-production-security-policy \
    --action=deny-403 \
    --description="Block path traversal" \
    --src-ip-ranges="*" \
    --expression="evaluatePreconfiguredWaf('linux-lfi-stable')" \
    --project="$PROJECT_ID"

# Local File Inclusion Protection
gcloud compute security-policies rules create 400 \
    --security-policy=chat-js-production-security-policy \
    --action=deny-403 \
    --description="Block LFI attacks" \
    --src-ip-ranges="*" \
    --expression="evaluatePreconfiguredWaf('linux-rfi-stable')" \
    --project="$PROJECT_ID"

# Suspicious User Agent Blocking
gcloud compute security-policies rules create 500 \
    --security-policy=chat-js-production-security-policy \
    --action=deny-403 \
    --description="Block suspicious user agents" \
    --src-ip-ranges="*" \
    --expression="
        lower(request.headers['user-agent']).contains('incorporate') ||
        lower(request.headers['user-agent']).contains('bot') ||
        lower(request.headers['user-agent']).contains('crawler') ||
        request.headers['user-agent'].size() == 0
    " \
    --project="$PROJECT_ID"

# API Rate Limiting
gcloud compute security-policies rules create 600 \
    --security-policy=chat-js-production-security-policy \
    --action="rate_based_ban" \
    --description="Rate limit API endpoints" \
    --src-ip-ranges="*" \
    --expression="request.path.startsWith('/api/')" \
    --rate-limit-threshold-count=100 \
    --rate-limit-threshold-interval-sec=60 \
    --ban-threshold-count=500 \
    --ban-threshold-interval-sec=300 \
    --conform-action="allow" \
    --exceed-action-rate-based-ban \
    --enforce-on-key="IP" \
    --project="$PROJECT_ID"

# Stricter Auth Rate Limiting
gcloud compute security-policies rules create 700 \
    --security-policy=chat-js-production-security-policy \
    --action="rate_based_ban" \
    --description="Stricter rate limit for auth" \
    --src-ip-ranges="*" \
    --expression="
        request.path.contains('/api/login') ||
        request.path.contains('/api/register') ||
        request.path.contains('/api/auth/')
    " \
    --rate-limit-threshold-count=5 \
    --rate-limit-threshold-interval-sec=300 \
    --ban-threshold-count=20 \
    --ban-threshold-interval-sec=3600 \
    --conform-action="allow" \
    --exceed-action-rate-based-ban \
    --enforce-on-key="IP" \
    --project="$PROJECT_ID"

# Allow legitimate traffic (lowest priority)
gcloud compute security-policies rules create 2147483647 \
    --security-policy=chat-js-production-security-policy \
    --action=allow \
    --description="Allow legitimate traffic" \
    --src-ip-ranges="*" \
    --expression="true" \
    --project="$PROJECT_ID"

echo "✅ Configured WAF rules"

# ========================================
# 2. BACKEND BACKEND FIREWALL RULES
# ========================================
echo "🔥 Creating firewall rules..."

# Allow health checks
gcloud compute firewall-rules create "allow-health-checks" \
    --description="Allow Google health checks" \
    --allow=tcp:80,tcp:443 \
    --source-ranges="130.211.0.0/22,35.191.0.0/16,209.85.152.0/22,209.85.204.0/22" \
    --target-tags="chat-js-backend" \
    --project="$PROJECT_ID"

# Allow Cloud Load Balancer
gcloud compute firewall-rules create "allow-lb-probe" \
    --description="Allow load balancer health checks" \
    --allow=tcp:8080 \
    --source-ranges="35.191.0.0/16,130.211.0.0/22" \
    --target-tags="chat-js-backend" \
    --project="$PROJECT_ID"

echo "✅ Created firewall rules"

# ========================================
# 3. CLOUD CDN SETUP
# ========================================
echo "💰 Setting up Cloud CDN for performance..."

# Create backend bucket for static assets
gcloud compute backend-buckets create "chat-js-static-backend" \
    --description="Static assets for Chat-JS" \
    --gcs-bucket-name="chat-js-static-$PROJECT_ID" \
    --enable-cdn \
    --cache-mode="CACHE_ALL_STATIC" \
    --project="$PROJECT_ID"

# Create URL map
gcloud compute url-maps create "chat-js-url-map" \
    --description="URL routing for Chat-JS" \
    --default-service="chat-js-backend-service" \
    --project="$PROJECT_ID"

# Add path rules for static assets
gcloud compute url-maps add-path-matcher "chat-js-url-map" \
    --description="Static assets routing" \
    --path-matcher-name="static-assets" \
    --new-hosts="yourdomain.com" \
    --backend-bucket-path-rules="/static/*=chat-js-static-backend" \
    --project="$PROJECT_ID"

echo "🔗 Configured Cloud CDN"

# ========================================
# 4. SSL POLICIES
# ========================================
echo "🔐 Creating SSL policies..."

# Create managed SSL certificate
gcloud compute ssl-certificates create "chat-js-wildcard-cert" \
    --description="Wildcard SSL certificate for Chat-JS" \
    --domains="yourdomain.com,*.yourdomain.com" \
    --project="$PROJECT_ID"

# Create SSL policy for TLS 1.3
gcloud compute ssl-policies create "chat-js-ssl-policy" \
    --profile=MODERN \
    --min-tls-version=1.2 \
    --description="Secure SSL policy for Chat-JS" \
    --project="$PROJECT_ID"

echo "🔒 Configured SSL policies"

# ========================================
# 5. SECURITY HEADERS ENHANCEMENT
# ========================================
echo "🛡️ Enhancing security headers..."

curl -X PATCH "https://run.googleapis.com/v1/projects/$PROJECT_ID/locations/$REGION/services/chat-js-backend" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d '{
      "metadata": {
        "annotations": {
          "run.googleapis.com/ingress": "all",
          "run.googleapis.com/ingress-status": "all"
        }
      },
      "spec": {
        "template": {
          "metadata": {
            "annotations": {
              "run.googleapis.com/ingress": "all"
            }
          },
          "spec": {
            "containers": [{
              "env": [{
                "name": "SECURITY_HEADERS_ENABLED",
                "value": "true"
              }, {
                "name": "CSP_ENABLED",
                "value": "true"
              }]
            }]
          }
        }
      }
    }'

echo "🛡️ Enhanced security headers"

# ========================================
# 6. VERIFICATION
# ========================================
echo ""
echo "🔍 SECURITY VERIFICATION:"
echo ""

# Check security policy status
echo "🛡️ Security Policy Status:"
gcloud compute security-policies describe "chat-js-production-security-policy" \
    --format="table(name,description)" \
    --project="$PROJECT_ID"

# Check SSL certificate status
echo ""
echo "🔐 SSL Certificate Status:"
gcloud compute ssl-certificates describe "chat-js-wildcard-cert" \
    --format="table(name,managed.status,managed.domainStatus)" \
    --project="$PROJECT_ID"

# List firewall rules
echo ""
echo "🔥 Active Firewall Rules:"
gcloud compute firewall-rules list \
    --filter="name:chat-js-*" \
    --format="table(name,description,sourceRanges.list():label=SOURCES,targetTags.list():label=TARGETS)" \
    --project="$PROJECT_ID"

echo ""
echo "✅ PRODUCTION SECURITY SETUP COMPLETED!"
echo ""
echo "🚀 NEXT STEPS:"
echo "1. Update Load Balancer backend services to use the security policy"
echo "2. Configure domain routing and SSL certificates"
echo "3. Test WAF rules with legitimate and malicious requests"
echo "4. Set up security monitoring and alerting"
echo "5. Configure rate limiting thresholds based on traffic patterns"
echo ""
echo "🔗 SECURITY DASHBOARD:"
echo "https://console.cloud.google.com/net-security/security-policies"
echo "https://console.cloud.google.com/net-security/ssl-certificates"
echo ""
echo "⚠️ REMEMBER TO:"
echo "- Test all authentication flows after enabling security policies"
echo "- Monitor error rates for false positives"
echo "- Update rate limit thresholds based on real traffic"
echo "- Set up alerts for security violations"
echo ""

echo "🔒 Production security hardening is complete!"
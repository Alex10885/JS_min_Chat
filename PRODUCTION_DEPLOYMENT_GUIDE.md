# 🚀 CHAT-JS PRODUCTION DEPLOYMENT GUIDE
## Comprehensive Guide to Deploy on GCP Cloud Run

## 📋 OVERVIEW

This guide provides step-by-step instructions for deploying Chat-JS to Google Cloud Platform using Cloud Run, MongoDB Atlas, and production-ready infrastructure components.

### **Architecture Overview**
- **Backend**: Node.js + Express + Socket.IO (Cloud Run)
- **Frontend**: React SPA with Nginx (Cloud Run)
- **Database**: MongoDB Atlas
- **TURN Server**: Coturn (Cloud Run)
- **CDN**: Google Cloud CDN
- **Monitoring**: Cloud Logging + Cloud Monitoring

### **Production Features**
- ✅ Auto-scaling (0-20 instances)
- ✅ Health checks & monitoring
- ✅ SSL/TLS encryption
- ✅ Rate limiting & security
- ✅ Zero-downtime deployments
- ✅ Canary deployment support

---

## 🎯 PHASE 1: GCP INFRASTRUCTURE SETUP

### **Step 1.1: Prerequisites**

Before deployment, ensure you have:

```bash
# Install GCP CLI
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Authenticate GCP account
gcloud auth login
gcloud auth application-default login

# Set your GCP project
gcloud config set project YOUR_PROJECT_ID
gcloud config set region europe-west1
```

### **Step 1.2: Infrastructure Setup Script**

Run the provided setup script:

```bash
# Make script executable
chmod +x gcp-setup-production.sh

# Run infrastructure setup
./gcp-setup-production.sh
```

**What this script creates:**
- ✅ Service Account with proper permissions
- ✅ Artifact Registry for containers
- ✅ Secret Manager for sensitive data
- ✅ IAM roles and policies
- ✅ Cloud Storage bucket for static files

### **Step 1.3: Configure Secrets**

Set your production secrets:

```bash
# MongoDB Atlas Connection String
echo -n "mongodb+srv://username:password@cluster.mongodb.net/chatdb?retryWrites=true&w=majority" | \
gcloud secrets create MONGODB_URI --data-file=- --project=YOUR_PROJECT_ID

# JWT Secret (32-byte secure random)
openssl rand -hex 32 | \
gcloud secrets create JWT_SECRET --data-file=- --project=YOUR_PROJECT_ID

# TURN Server Secret
openssl rand -hex 32 | \
gcloud secrets create TURN_SECRET --data-file=- --project=YOUR_PROJECT_ID

# Email Service (if using Gmail)
echo -n "your-gmail-app-password" | \
gcloud secrets create EMAIL_PASS --data-file=- --project=YOUR_PROJECT_ID
```

---

## 🐳 PHASE 2: DOCKER CONTAINER BUILD

### **Step 2.1: Build Backend Container**

```bash
# Navigate to project root
cd /path/to/chat-js

# Build and tag backend
gcloud builds submit backend/ \
  --tag gcr.io/YOUR_PROJECT_ID/chat-js-backend:latest \
  --project=YOUR_PROJECT_ID
```

### **Step 2.2: Build Frontend Container**

```bash
# Build and tag frontend
gcloud builds submit frontend/ \
  --tag gcr.io/YOUR_PROJECT_ID/chat-js-frontend:latest \
  --project=YOUR_PROJECT_ID
```

### **Step 2.3: Build TURN Server Container**

```bash
# Build TURN server container
gcloud builds submit . \
  --config coturn.dockerfile \
  --tag gcr.io/YOUR_PROJECT_ID/chat-js-turn:latest \
  --project=YOUR_PROJECT_ID
```

---

## ☁️ PHASE 3: CLOUD RUN DEPLOYMENT

### **Step 3.1: Deploy Backend Service**

```bash
# Deploy backend to Cloud Run
gcloud run deploy chat-js-backend \
  --image gcr.io/YOUR_PROJECT_ID/chat-js-backend:latest \
  --platform managed \
  --region europe-west1 \
  --service-account chat-js-service@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --concurrency 80 \
  --cpu 2 \
  --memory 2Gi \
  --max-instances 20 \
  --min-instances 1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production" \
  --project=YOUR_PROJECT_ID
```

### **Step 3.2: Configure Backend Secrets**

```bash
# Add secrets to backend service
gcloud run services update chat-js-backend \
  --platform managed \
  --region europe-west1 \
  --set-secrets="JWT_SECRET=JWT_SECRET:latest" \
  --set-secrets="MONGODB_URI=MONGODB_URI:latest" \
  --set-secrets="TURN_SECRET=TURN_SECRET:latest" \
  --set-secrets="EMAIL_PASS=EMAIL_PASS:latest" \
  --project=YOUR_PROJECT_ID
```

### **Step 3.3: Deploy Frontend Service**

```bash
# Deploy frontend to Cloud Run
gcloud run deploy chat-js-frontend \
  --image gcr.io/YOUR_PROJECT_ID/chat-js-frontend:latest \
  --platform managed \
  --region europe-west1 \
  --service-account chat-js-service@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --concurrency 200 \
  --cpu 0.5 \
  --memory 512Mi \
  --max-instances 5 \
  --min-instances 1 \
  --port 80 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production" \
  --project=YOUR_PROJECT_ID
```

### **Step 3.4: Deploy TURN Server**

```bash
# Deploy TURN server
gcloud run deploy chat-js-turn \
  --image gcr.io/YOUR_PROJECT_ID/chat-js-turn:latest \
  --platform managed \
  --region europe-west1 \
  --port 3478 \
  --allow-unauthenticated \
  --concurrency 1000 \
  --cpu 1 \
  --memory 1Gi \
  --max-instances 10 \
  --udp \
  --project=YOUR_PROJECT_ID
```

---

## 🔒 PHASE 4: SECURITY CONFIGURATION

### **Step 4.1: Cloud Armor WAF Setup**

```bash
# Create Cloud Armor security policy
gcloud compute security-policies create chat-js-security-policy \
  --description="Chat-JS security policy" \
  --project=YOUR_PROJECT_ID

# Add OWASP rules
gcloud compute security-policies rules create 1000 \
  --security-policy=chat-js-security-policy \
  --action=deny-403 \
  --description="OWASP Top 10 protection" \
  --src-ip-ranges="*" \
  --expression="evaluatePostfix(request.method, \"POST\") &&
    evaluatePostfix(request.path, \"/api/\") &&
    evaluateOwaspTop10(request)"
```

### **Step 4.2: Domain & SSL Setup**

```bash
# Reserve IP address
gcloud compute addresses create chat-js-ip \
  --global \
  --ip-version=IPV4 \
  --project=YOUR_PROJECT_ID

# Create custom domain mapping
gcloud run domain-mappings create \
  --service=chat-js-frontend \
  --platform=managed \
  --region=europe-west1 \
  --domain=yourdomain.com \
  --project=YOUR_PROJECT_ID
```

---

## 🔄 PHASE 5: CI/CD PIPELINE SETUP

### **Step 5.1: GitHub Actions Setup**

Create `.github/workflows/production.yml`:

```yaml
name: Production Deployment

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: |
          cd backend && npm ci && npm test
          cd ../frontend && npm ci && npm test

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: google-github-actions/setup-gcloud@v1
        with:
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          project_id: ${{ secrets.GCP_PROJECT_ID }}

      - name: Build and Deploy Staging
        run: |
          gcloud builds submit --config cloudbuild.yaml --substitutions=_ENVIRONMENT=staging

  deploy-production:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: google-github-actions/setup-gcloud@v1
        with:
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          project_id: ${{ secrets.GCP_PROJECT_ID }}

      - name: Build and Deploy Production
        run: |
          gcloud builds submit --config cloudbuild.yaml --substitutions=_ENVIRONMENT=production
```

### **Step 5.2: Environment Variables Setup**

In GitHub repository settings, add:

```bash
GCP_PROJECT_ID=your-gcp-project-id
GCP_SA_KEY=service-account-json-key
GCP_REGION=europe-west1
```

---

## 📊 PHASE 6: MONITORING & LOGGING

### **Step 6.1: Cloud Monitoring Setup**

```bash
# Create uptime checks
gcloud monitoring uptime-check-configs create chat-js-uptime \
  --display-name="Chat-JS Uptime Check" \
  --resource-type=url \
  --http-check-path=/health \
  --http-check-port=443 \
  --checked-resource=https://yourdomain.com \
  --selected-regions=europe-west1 \
  --project=YOUR_PROJECT_ID

# Create alerts
gcloud monitoring alert-policies create chat-js-error-rate \
  --description="High error rate alert" \
  --condition-display-name="Error Rate > 5%" \
  --condition-filter="metric.type=\"logging.googleapis.com/log_entry_count\" resource.type=\"cloud_run_revision\" severity>=ERROR" \
  --condition-threshold-value=5 \
  --condition-threshold-duration=300s \
  --condition-comparison=COMPARISON_GT \
  --notification-channels=your-notification-channel \
  --project=YOUR_PROJECT_ID
```

### **Step 6.2: Custom Metrics**

```bash
# Create custom dashboard
gcloud monitoring dashboards create chat-js-dashboard \
  --display-name="Chat-JS Production Dashboard" \
  --project=YOUR_PROJECT_ID

# Add CPU usage chart
gcloud monitoring dashboards widgets create chat-js-dashboard \
  --widget-type=XyChart \
  --title="CPU Usage" \
  --query="fetch cloud_run_revision | metric 'run.googleapis.com/container/cpu/utilization' | filter resource.service_name =~ 'chat-js-.*'" \
  --project=YOUR_PROJECT_ID
```

---

## 🚀 PHASE 7: PRODUCTION LAUNCH

### **Step 7.1: Pre-Launch Checklist**

- [ ] All secrets configured in Secret Manager
- [ ] Domain DNS configured
- [ ] SSL certificates issued
- [ ] Monitoring and alerts configured
- [ ] Load balancing set up
- [ ] Backup procedures tested

### **Step 7.2: Go-Live Process**

```bash
# 1. Final test deployment
gcloud run deploy chat-js-backend \
  --image gcr.io/YOUR_PROJECT_ID/chat-js-backend:v1.0.0 \
  --platform managed \
  --no-traffic \
  --tag production-v1.0.0

# 2. Smoke testing
curl -f https://api.yourdomain.com/health
curl -f https://yourdomain.com/health

# 3. Canary deployment (10% traffic)
gcloud run services update-traffic chat-js-backend \
  --to-revisions=production-v1.0.0=10 \
  --to-revisions=previous=90

# 4. Monitor for 15 minutes
sleep 900

# 5. Full rollout (100% traffic)
gcloud run services update-traffic chat-js-backend \
  --to-revisions=production-v1.0.0=100
```

### **Step 7.3: Post-Launch Verification**

```bash
# Verify all services are healthy
gcloud run services list --region europe-west1 --project=YOUR_PROJECT_ID

# Check container logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=chat-js-backend" --limit=10

# Verify SSL certificate
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

---

## 🔧 OPERATIONAL PROCEDURES

### **Backup & Recovery**

```bash
# MongoDB Atlas backup (automated daily)
# MongoDB Atlas handles automatic backups

# Database export (manual)
mongodump --uri="$MONGODB_URI" --out=/backup/$(date +%Y%m%d_%H%M%S)

# Database restore
mongorestore --uri="$MONGODB_URI" /backup/latest_backup
```

### **Scaling Procedures**

```bash
# Manual scaling
gcloud run services update chat-js-backend \
  --concurrency 100 \
  --max-instances 30 \
  --min-instances 2

# Auto-scaling is configured by default
```

### **Emergency Rollback**

```bash
# Immediate rollback to previous version
gcloud run services update-traffic chat-js-backend \
  --to-revisions=previous=100
```

---

## 📝 TROUBLESHOOTING

### **Common Issues & Solutions**

#### Issue: Service failing to start
```bash
# Check container logs
gcloud logging read "resource.type=cloud_run_revision" \
  --filter="resource.labels.service_name=chat-js-backend" \
  --limit=50

# Check for missing secrets
gcloud secrets list
```

#### Issue: High latency
```bash
# Check resource utilization
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com/container/cpu/utilization"

# Consider increasing resources
gcloud run services update chat-js-backend \
  --cpu 4 \
  --memory 4Gi
```

#### Issue: Database connection failures
```bash
# Check MongoDB Atlas status
# Verify connection string in Secret Manager
gcloud secrets versions access latest --secret="MONGODB_URI"
```

---

## 📞 SUPPORT & CONTACTS

### **Emergency Contacts**
- **DevOps Lead**: devops@yourcompany.com
- **Database Admin**: dba@yourcompany.com
- **Security Team**: security@yourcompany.com

### **Monitoring Resources**
- **Dashboard**: https://console.cloud.google.com/monitoring/dashboards
- **Logs**: https://console.cloud.google.com/logs
- **Alerts**: https://console.cloud.google.com/monitoring/alerting

---

## 📋 DEPLOYMENT CHECKLIST

### **Pre-Deployment**
- [ ] Infrastructure setup script executed
- [ ] Secrets configured in Secret Manager
- [ ] Service account permissions set
- [ ] Artifact Registry created

### **Deployment**
- [ ] Backend container built successfully
- [ ] Frontend container built successfully
- [ ] Cloud Run services deployed
- [ ] Secrets attached to services
- [ ] Domain mappings configured

### **Security**
- [ ] SSL certificates issued
- [ ] Cloud Armor rules applied
- [ ] CORS policies configured
- [ ] Content Security Policy active

### **Monitoring**
- [ ] Cloud Logging configured
- [ ] Uptime checks active
- [ ] Alert policies set
- [ ] Custom dashboards created

### **Post-Launch**
- [ ] Smoke tests passed
- [ ] Performance benchmarks taken
- [ ] Backup procedures verified
- [ ] Incident response tested

---

## 🚨 EMERGENCY PROCEDURES

### **Critical Incident Response**

1. **Immediate Actions**
   ```bash
   # Check service status
   gcloud run services describe chat-js-backend --region=europe-west1

   # Check error logs
   gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" --limit=20
   ```

2. **Traffic Management**
   ```bash
   # Redirect all traffic to stable version
   gcloud run services update-traffic chat-js-backend --to-revisions=stable=100

   # Deploy hotfix
   gcloud run deploy chat-js-backend --image=gcr.io/$PROJECT_ID/chat-js-backend:hotfix-v1.0.1
   ```

3. **Database Recovery**
   ```bash
   # Restore from backup
   mongorestore --uri="$MONGODB_URI" /path/to/backup
   ```

**🔥 EMERGENCY HOTLINE: +1 (555) 123-4567**

---

## 📈 PERFORMANCE MONITORING

### **Key Metrics to Monitor**

| Component | Metric | Threshold | Action |
|-----------|--------|-----------|--------|
| Backend | CPU Usage | >80% | Increase CPU limit |
| Frontend | Memory Usage | >85% | Increase memory |
| Database | Connection Count | >90% | Scale database |
| Network | Error Rate | >1% | Investigate errors |
| WebRTC | TURN Connections | >1000 | Scale TURN server |

### **Alert Conditions**

- **Critical**: Service unavailable >5 minutes
- **Warning**: Error rate >1%
- **Info**: High resource utilization >80%

---

## 🔄 MAINTENANCE SCHEDULE

### **Weekly Tasks**
- [ ] Review error logs
- [ ] Check resource utilization
- [ ] Update security patches
- [ ] Database optimization

### **Monthly Tasks**
- [ ] Database backup verification
- [ ] Performance benchmark testing
- [ ] Security assessment
- [ ] Dependency updates

### **Quarterly Tasks**
- [ ] Infrastructure cost analysis
- [ ] Load testing
- [ ] Disaster recovery testing
- [ ] Security audit

---

**🎯 CHARTER OF SUCCESS:**
Production deployment is complete when all services are running, monitored, secure, and able to handle production traffic loads with less than 1% error rate and sub-100ms response times for 95% of requests.

**🚀 READY FOR PRODUCTION LAUNCH!**
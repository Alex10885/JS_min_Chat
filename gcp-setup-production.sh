#!/bin/bash
# ========================================
# GCP PRODUCTION SETUP SCRIPT FOR CHAT-JS
# ========================================
# This script sets up complete production infrastructure on GCP

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-your-gcp-project-id}"
REGION="${GCP_REGION:-europe-west1}"
SERVICE_NAME="chat-js"
SERVICE_ACCOUNT_NAME="${SERVICE_NAME}-service"

echo "🚀 Starting GCP production setup for project: $PROJECT_ID"

# Enable required APIs
echo "📦 Enabling GCP APIs..."
gcloud services enable run.googleapis.com \
    secretmanager.googleapis.com \
    sqladmin.googleapis.com \
    compute.googleapis.com \
    artifactregistry.googleapis.com \
    container.googleapis.com \
    monitoring.googleapis.com \
    logging.googleapis.com \
    --project=$PROJECT_ID

# Create service account
echo "👤 Creating service account..."
gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
    --description="Service account for Chat-JS production" \
    --display-name="Chat-JS Production Service Account" \
    --project=$PROJECT_ID

# Grant necessary permissions
echo "🔐 Granting permissions to service account..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/monitoring.metricWriter"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/logging.logWriter"

# Download service account key (for Cloud Build and local development)
echo "🔑 Creating service account key..."
gcloud iam service-accounts keys create secrets/gcp-service-account.json \
    --iam-account="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project=$PROJECT_ID

# Create secrets in Secret Manager
echo "🔒 Creating production secrets..."

# JWT Secret (256-bit secure key)
JWT_SECRET=$(openssl rand -hex 32)
echo -n "$JWT_SECRET" | gcloud secrets create JWT_SECRET \
    --data-file=- \
    --project=$PROJECT_ID

# MongoDB Atlas URI (you'll need to provide your actual MongoDB Atlas connection string)
echo "⚠️  IMPORTANT: You need to configure these secrets with your actual values:"
echo "   - MongoDB Atlas connection string"
echo "   - Email service credentials"
echo "   - TURN server secrets"
echo ""
echo "📝 Template commands to run manually:"
echo ""
echo "# Create MongoDB Atlas secret:"
echo "echo -n \"mongodb+srv://username:password@cluster.mongodb.net/chatdb?retryWrites=true&w=majority\" | \\"
echo "gcloud secrets create MONGODB_URI --data-file=- --project=$PROJECT_ID"
echo ""
echo "# Create Email service secret:"
echo "echo -n \"your-gmail-app-password\" | \\"
echo "gcloud secrets create EMAIL_PASS --data-file=- --project=$PROJECT_ID"
echo ""
echo "# Create TURN secret:"
echo "openssl rand -hex 32 | \\"
echo "gcloud secrets create TURN_SECRET --data-file=- --project=$PROJECT_ID"
echo ""

# Create Cloud Config Maps for non-sensitive configuration
echo "🗂️  Creating configuration maps..."

# Frontend configuration
cat << EOF > frontend-config.yaml
data:
  API_BASE_URL: "https://chat-js-backend-[PROJECT_HASH]-[REGION].run.app"
  WS_BASE_URL: "wss://chat-js-backend-[PROJECT_HASH]-[REGION].run.app"
  CLIENT_URL: "https://chat-js-frontend-[PROJECT_HASH]-[REGION].run.app"
EOF

gcloud configmaps create frontend-env \
    --from-file=frontend-config.yaml \
    --project=$PROJECT_ID

# Backend configuration settings
cat << EOF > backend-config.yaml
data:
  NODE_ENV: "production"
  PORT: "8080"
  LOG_LEVEL: "info"
  BCRYPT_SALT_ROUNDS: "12"
  MAX_PAYLOAD_SIZE: "10mb"
  AUTH_RATE_LIMIT_WINDOW_MS: "900000"
  AUTH_RATE_LIMIT_MAX: "3"
  API_RATE_LIMIT_WINDOW_MS: "900000"
  API_RATE_LIMIT_MAX: "60"
  GENERAL_RATE_LIMIT_WINDOW_MS: "3600000"
  GENERAL_RATE_LIMIT_MAX: "500"
EOF

gcloud configmaps create env-config \
    --from-file=backend-config.yaml \
    --project=$PROJECT_ID

# Create artifact registry repository
echo "🔨 Creating Artifact Registry repository..."
gcloud artifacts repositories create $SERVICE_NAME \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for Chat-JS" \
    --project=$PROJECT_ID

# Build and tag initial images
echo "🏗️  Building initial production images..."
echo "⚠️  Note: You need to run these commands from your project root:"
echo ""
echo "cd backend && docker build -f Dockerfile.production -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/chat-js-backend:latest ."
echo "cd .. && docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/chat-js-backend:latest"
echo ""
echo "cd frontend && docker build -f Dockerfile.production -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/chat-js-frontend:latest ."
echo "cd .. && docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/chat-js-frontend:latest"
echo ""

# Set up Cloud Storage bucket for static assets (optional)
echo "🪣 Creating Cloud Storage bucket for static assets..."
BUCKET_NAME="${SERVICE_NAME}-static-${PROJECT_ID}"
gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME

# Firewall rules for TURN server (if not using Cloud Run for TURN)
echo "🔥 Creating firewall rules for TURN server (if needed)..."
# Note: TURN server will be deployed on Cloud Run, so these are optional

# Enable monitoring and logging
echo "📊 Setting up monitoring and alerting..."
echo "✅ GCP infrastructure setup complete!"
echo ""
echo "🎯 Next steps:"
echo "1. Configure your secrets (MONGODB_URI, EMAIL_PASS, TURN_SECRET)"
echo "2. Build and push your Docker images to Artifact Registry"
echo "3. Deploy using Cloud Run services"
echo "4. Set up custom domain and SSL certificates"
echo "5. Configure monitoring and alerting"
echo ""

echo "📚 Useful commands:"
echo "# Deploy backend:"
echo "gcloud run deploy chat-js-backend --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/chat-js-backend:latest --platform managed --region $REGION"
echo ""
echo "# Deploy frontend:"
echo "gcloud run deploy chat-js-frontend --image ${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/chat-js-frontend:latest --platform managed --region $REGION"
echo ""
echo "# Check deployments:"
echo "gcloud run services list --region $REGION"
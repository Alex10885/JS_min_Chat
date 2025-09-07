#!/bin/bash
# ========================================
# CHAT-JS PRODUCTION PRE-FLIGHT VALIDATION
# ========================================
# Automated script to validate production readiness
# Run this BEFORE every deployment to catch issues early

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${REGION:-europe-west1}"
DOMAIN="${DOMAIN:-yourdomain.com}"

# Results tracking
CHECKS_PASSED=0
CHECKS_TOTAL=0
ISSUES_FOUND=0

# Helper functions
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓ PASS]${NC} $1"
    ((CHECKS_PASSED++))
}

print_warning() {
    echo -e "${YELLOW}[⚠ WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗ FAIL]${NC} $1"
    ((ISSUES_FOUND++))
}

check_command() {
    command -v "$1" >/dev/null 2>&1
}

# ========================================
# PHASE 1: ENVIRONMENT VALIDATION
# ========================================
echo "========================================="
echo "🚀 PHASE 1: ENVIRONMENT VALIDATION"
echo "========================================="

# Check if GitHub CLI is available
((CHECKS_TOTAL++))
if check_command gh; then
    print_success "GitHub CLI is available"
else
    print_error "GitHub CLI not found - install it first"
fi

# Check if gcloud is available
((CHECKS_TOTAL++))
if check_command gcloud; then
    print_success "Google Cloud CLI is available"
else
    print_error "Google Cloud CLI not found - install it first"
fi

# Check if docker is available
((CHECKS_TOTAL++))
if check_command docker; then
    print_success "Docker is available"
else
    print_error "Docker not found - install it first"
fi

# Check if project is configured
((CHECKS_TOTAL++))
if [ -z "$PROJECT_ID" ]; then
    print_error "GCP_PROJECT_ID not configured"
else
    print_success "GCP project ID configured: $PROJECT_ID"
fi

# ========================================
# PHASE 2: GCP INFRASTRUCTURE VALIDATION
# ========================================
echo ""
echo "========================================="
echo "☁️ PHASE 2: GCP INFRASTRUCTURE VALIDATION"
echo "========================================="

# Check if gcloud is authenticated
((CHECKS_TOTAL++))
if gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    print_success "GCP authentication is active"
else
    print_error "GCP authentication required - run 'gcloud auth login'"
fi

# Check if project exists and is accessible
((CHECKS_TOTAL++))
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    print_success "GCP project $PROJECT_ID is accessible"
else
    print_error "GCP project $PROJECT_ID is not accessible"
fi

# Check if Artifact Registry exists
((CHECKS_TOTAL++))
if gcloud artifacts repositories describe chat-js --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    print_success "Artifact Registry 'chat-js' exists"
else
    print_warning "Artifact Registry 'chat-js' not found - will be created by setup script"
fi

# Check Service Account permissions
((CHECKS_TOTAL++))
SERVICE_ACCOUNT="chat-js-service@$PROJECT_ID.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
    print_success "Service Account exists: $SERVICE_ACCOUNT"
else
    print_error "Service Account not found - run setup script first"
fi

# ========================================
# PHASE 3: SECRETS VALIDATION
# ========================================
echo ""
echo "========================================="
echo "🔐 PHASE 3: SECRETS VALIDATION"
echo "========================================="

SECRETS=("JWT_SECRET" "MONGODB_URI" "TURN_SECRET" "EMAIL_PASS")
for secret in "${SECRETS[@]}"; do
    ((CHECKS_TOTAL++))
    if gcloud secrets versions list "$secret" --project="$PROJECT_ID" --format="value(STATE)" | grep -q "ENABLED"; then
        print_success "Secret '$secret' is configured"
    else
        print_error "Secret '$secret' is missing"
    fi
done

# ========================================
# PHASE 4: CONTAINER VALIDATION
# ========================================
echo ""
echo "========================================="
echo "🐳 PHASE 4: CONTAINER VALIDATION"
echo "========================================="

# Check if required files exist
((CHECKS_TOTAL++))
if [ -f "backend/Dockerfile.production" ]; then
    print_success "Backend Dockerfile exists"
else
    print_error "Backend Dockerfile.production not found"
fi

((CHECKS_TOTAL++))
if [ -f "frontend/Dockerfile.production" ]; then
    print_success "Frontend Dockerfile exists"
else
    print_error "Frontend Dockerfile.production not found"
fi

((CHECKS_TOTAL++))
if [ -f "frontend/nginx.production.conf" ]; then
    print_success "Nginx production config exists"
else
    print_error "Frontend nginx.production.conf not found"
fi

((CHECKS_TOTAL++))
if [ -f "backend/.env.production.example" ]; then
    print_success "Production environment template exists"
else
    print_error "Production environment template not found"
fi

# ========================================
# PHASE 5: CODE QUALITY VALIDATION
# ========================================
echo ""
echo "========================================="
echo "💻 PHASE 5: CODE QUALITY VALIDATION"
echo "========================================="

# Check backend tests
((CHECKS_TOTAL++))
if [ -d "backend/tests" ]; then
    print_success "Backend tests directory exists"
else
    print_error "Backend tests directory not found"
fi

# Check frontend tests
((CHECKS_TOTAL++))
if [ -d "frontend/cypress" ]; then
    print_success "Frontend Cypress tests directory exists"
else
    print_warning "Frontend Cypress tests directory not found"
fi

# Check if git repository is clean
((CHECKS_TOTAL++))
if git diff --quiet && git diff --staged --quiet; then
    print_success "Working directory is clean"
else
    print_warning "Working directory has uncommitted changes"
fi

# Check if required scripts exist
((CHECKS_TOTAL++))
if [ -f "gcp-setup-production.sh" ]; then
    print_success "GCP setup script exists"
else
    print_error "GCP setup script not found"
fi

# ========================================
# PHASE 6: CLOUD RUN SERVICE VALIDATION
# ========================================
echo ""
echo "========================================="
echo "⚡ PHASE 6: CLOUD RUN SERVICE VALIDATION"
echo "========================================="

# Check Cloud Run service configs
((CHECKS_TOTAL++))
if [ -f "backend/cloud-run.backend.yaml" ]; then
    print_success "Backend Cloud Run config exists"
else
    print_error "Backend Cloud Run config not found"
fi

((CHECKS_TOTAL++))
if [ -f "frontend/cloud-run.frontend.yaml" ]; then
    print_success "Frontend Cloud Run config exists"
else
    print_error "Frontend Cloud Run config not found"
fi

# ========================================
# PHASE 7: CONFIGURATION VALIDATION
# ========================================
echo ""
echo "========================================="
echo "⚙️ PHASE 7: CONFIGURATION VALIDATION"
echo "========================================="

# Check Cloud Build configuration
((CHECKS_TOTAL++))
if [ -f "cloudbuild.yaml" ]; then
    print_success "Cloud Build configuration exists"
else
    print_error "Cloud Build configuration not found"
fi

# Check MongoDB connection (if secrets are available)
((CHECKS_TOTAL++))
if gcloud secrets versions access latest --secret="MONGODB_URI" --project="$PROJECT_ID" >/dev/null 2>&1; then
    MONGODB_URI=$(gcloud secrets versions access latest --secret="MONGODB_URI" --project="$PROJECT_ID")
    if curl -s --connect-timeout 5 "$MONGODB_URI/db" >/dev/null 2>&1; then
        print_success "MongoDB connection is accessible"
    else
        print_warning "MongoDB connection check failed - verify URI"
    fi
else
    print_warning "MongoDB URI secret not accessible - cannot verify connection"
fi

# ========================================
# PHASE 8: NETWORKING VALIDATION
# ========================================
echo ""
echo "========================================="
echo "🌐 PHASE 8: NETWORKING VALIDATION"
echo "========================================="

# Check DNS resolution
((CHECKS_TOTAL++))
if nslookup "api.$DOMAIN" >/dev/null 2>&1; then
    print_success "DNS for api.$DOMAIN resolves"
else
    print_warning "DNS for api.$DOMAIN not configured yet"
fi

((CHECKS_TOTAL++))
if nslookup "$DOMAIN" >/dev/null 2>&1; then
    print_success "DNS for $DOMAIN resolves"
else
    print_warning "DNS for $DOMAIN not configured yet"
fi

# ========================================
# SUMMARY REPORT
# ========================================
echo ""
echo "========================================="
echo "📊 PRE-FLIGHT VALIDATION SUMMARY"
echo "========================================="

PASS_RATE=$((CHECKS_PASSED * 100 / CHECKS_TOTAL))
echo ""
echo "🎯 Overall Health Score: $PASS_RATE% ($CHECKS_PASSED/$CHECKS_TOTAL checks passed)"

if [ "$ISSUES_FOUND" -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL CHECKS PASSED! Ready for deployment.${NC}"
    echo ""
    echo "🚀 Next steps:"
    echo "1. Run: ./gcp-setup-production.sh"
    echo "2. Build: gcloud builds submit . --config cloudbuild.yaml"
    echo "3. Deploy: Follow PRODUCTION_DEPLOYMENT_GUIDE.md"
    exit 0
else
    echo -e "${YELLOW}⚠️  FOUND $ISSUES_FOUND ISSUES that need attention.${NC}"
    echo ""
    echo "🔧 Fix the issues above and re-run this script."
    echo "📖 See PRODUCTION_DEPLOYMENT_GUIDE.md for detailed instructions."
    exit 1
fi
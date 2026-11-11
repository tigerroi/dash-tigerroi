#!/bin/bash
# ==============================================================================
# TigerROI - Script Otomatis Instalasi Supabase Self-Hosted di Hetzner (CPX42)
# ==============================================================================
set -e

echo "========================================================================"
echo "   TIGERROI - MEMULAI INSTALASI SUPABASE SELF-HOSTED DI HETZNER CPX42   "
echo "========================================================================"

# 1. Pastikan Git dan Docker Compose tersedia
if ! command -v git &> /dev/null; then
    echo "📦 Memasang Git..."
    apt-get update && apt-get install -y git curl openssl jq
fi

# 2. Siapkan direktori kerja di /opt/supabase
INSTALL_DIR="/opt/supabase"
echo "📁 Menyiapkan direktori di $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# 3. Unduh repositori resmi docker Supabase jika belum ada
if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    echo "⬇️  Mengunduh template resmi Supabase Docker..."
    git clone --depth 1 https://github.com/supabase/supabase.git temp_repo
    cp -rf temp_repo/docker/* "$INSTALL_DIR/"
    rm -rf temp_repo
fi

cd "$INSTALL_DIR"

# 4. Generate Random Passwords & Secrets
echo "🔑 Menghasilkan Password dan Kunci Keamanan Baru..."
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 20)
JWT_SECRET=$(openssl rand -base64 36 | tr -dc 'a-zA-Z0-9' | head -c 32)
DASHBOARD_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

# Helper untuk generate JWT HS256
b64enc() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }
sign_jwt() {
    local payload="$1"
    local secret="$2"
    local header='{"alg":"HS256","typ":"JWT"}'
    local h_b64=$(echo -n "$header" | b64enc)
    local p_b64=$(echo -n "$payload" | b64enc)
    local sig=$(echo -n "${h_b64}.${p_b64}" | openssl dgst -binary -sha256 -hmac "$secret" | b64enc)
    echo "${h_b64}.${p_b64}.${sig}"
}

NOW=$(date +%s)
EXP=$((NOW + 315360000)) # 10 tahun

ANON_PAYLOAD="{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":$NOW,\"exp\":$EXP}"
ANON_KEY=$(sign_jwt "$ANON_PAYLOAD" "$JWT_SECRET")

SERVICE_PAYLOAD="{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":$NOW,\"exp\":$EXP}"
SERVICE_ROLE_KEY=$(sign_jwt "$SERVICE_PAYLOAD" "$JWT_SECRET")

# 5. Konfigurasi file .env
cp .env.example .env

sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_PASSWORD}|g" .env
sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|g" .env
sed -i "s|ANON_KEY=.*|ANON_KEY=${ANON_KEY}|g" .env
sed -i "s|SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}|g" .env
sed -i "s|DASHBOARD_USERNAME=.*|DASHBOARD_USERNAME=admin|g" .env
sed -i "s|DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}|g" .env
sed -i "s|SITE_URL=.*|SITE_URL=https://dash.tigerroi.com|g" .env
sed -i "s|ADDITIONAL_REDIRECT_URLS=.*|ADDITIONAL_REDIRECT_URLS=https://dash.tigerroi.com/*|g" .env
sed -i "s|API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://db.tigerroi.com|g" .env

echo "🐳 Menarik image Docker dan menjalankan Supabase container..."
docker compose pull
docker compose up -d

echo ""
echo "========================================================================"
echo "🎉 SUPABASE SELF-HOSTED BERHASIL DIPASANG DI HETZNER CPX42! 🎉"
echo "========================================================================"
echo "Simpan informasi kredensial berikut dengan aman di komputer Anda:"
echo ""
echo "Endpoint API URL        : https://db.tigerroi.com"
echo "Supabase Studio Web UI  : http://$(curl -s ifconfig.me):3000 (User: admin / Pass: $DASHBOARD_PASSWORD)"
echo "Postgres Password (DB)  : $DB_PASSWORD"
echo ""
echo "ANON_KEY (Untuk Frontend Cloudflare Pages & Plugin WordPress):"
echo "$ANON_KEY"
echo ""
echo "SERVICE_ROLE_KEY (Untuk Backend Job GitHub Actions):"
echo "$SERVICE_ROLE_KEY"
echo ""
echo "Catatan: Kunci kredensial ini juga tersimpan aman di berkas /opt/supabase/.env"
echo "========================================================================"


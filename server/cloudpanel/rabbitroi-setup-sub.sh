#!/usr/bin/env bash
#
# rabbitroi-setup-sub — Setup Sub dari dashboard: site CloudPanel + WordPress + SSL + plugin RabbitROI.
#
# Dipanggil server kontrol lewat SSH (tombol "Setup" di tab Setup Sub, /setup-sub). Turunan dari
# create-wordpress-site.sh, dengan tiga beda yang disengaja:
#
#   1. IDEMPOTENT. Tiap langkah memeriksa apakah hasilnya sudah ada. SSL yang gagal karena DNS belum
#      menjalar diulang dengan menekan tombol yang sama, bukan dengan menghapus site setengah jadi.
#   2. Nama site user / database mengikuti konvensi server ini (news.bispdailyupdates.pk ->
#      bispdailyupdates-news), bukan potongan 16 karakter yang bisa bentrok antar-subdomain.
#   3. Plugin RabbitROI DISALIN dari situs lain di server ini (versi tertinggi). Server yang belum
#      punya satu pun memasang rabbitroi.zip yang dikirim server kontrol lewat STDIN — zip rilis
#      terbaru repo privatnya. Token GitHub TIDAK PERNAH ada di server ini: root-nya dibagi dengan
#      puluhan situs, dan token di sini berarti satu server bobol membuka seluruh source plugin.
#      Zip-nya dihapus saat skrip selesai. Plugin yang terpasang memperbarui dirinya sendiri
#      sesudahnya lewat tombol Update di /plugin.
#
# Argumen HANYA dua (+ sidik skrip opsional) dan diperiksa ketat: ia datang dari SSH_ORIGINAL_COMMAND (lihat
# rabbitroi-setup-sub-ssh), jadi tiap karakter di luar pola ditolak sebelum menyentuh apa pun.
#
# Keluaran: log langkah di stderr, lalu SATU baris `RESULT {json}` di stdout.
#
# PASANG (sekali, sebagai root di server CloudPanel):
#   install -m 755 rabbitroi-setup-sub.sh     /usr/local/sbin/rabbitroi-setup-sub
#   install -m 755 rabbitroi-setup-sub-ssh.sh /usr/local/sbin/rabbitroi-setup-sub-ssh
#   echo 'rabbitroi ALL=(root) NOPASSWD: /usr/local/sbin/rabbitroi-setup-sub' > /etc/sudoers.d/rabbitroi-setup-sub
#   chmod 440 /etc/sudoers.d/rabbitroi-setup-sub && visudo -c
#   # ~rabbitroi/.ssh/authorized_keys — kunci publik server kontrol, DIKUNCI ke satu perintah:
#   restrict,command="/usr/local/sbin/rabbitroi-setup-sub-ssh" ssh-ed25519 AAAA... rabbit-control
#
set -euo pipefail

DOMAIN="${1:-}"
ADMIN_EMAIL="${2:-}"
# sha256 skrip ini menurut server kontrol. Beda = skrip di sini versi lama: jawab OUTDATED tanpa
# menyentuh apa pun, dan server kontrol memasang ulang lewat bootstrap lalu mengulang run-nya.
EXPECTED_SHA="${3:-}"

fail() { echo "ERROR $*" >&2; exit 1; }
log() { echo ">> $*" >&2; }

[[ $EUID -eq 0 ]] || fail "harus dijalankan sebagai root"
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail "nama domain tidak sah: $DOMAIN"
[[ "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || fail "email admin tidak sah"
[[ -z "$EXPECTED_SHA" || "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || fail "sidik skrip tidak sah"

# Zip plugin dari server kontrol (stdin; kosong = tidak dikirim). SELALU dihabiskan di sini, walau
# plugin nanti disalin dari situs lain: pengirim yang stdin-nya berhenti dibaca di tengah akan patah.
# Di direktori root 700, dan dihapus di EXIT apa pun hasilnya.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PLUGIN_ZIP="$TMP/rabbitroi.zip"
# Dua baris pertama stdin: username + password admin WordPress bawaan armada (kosong = "rabbitroi" +
# acak). Lewat stdin, bukan argumen: argumen terbaca di daftar proses dan log sudo. `read` membaca
# per byte dari pipa, jadi sisanya — zip — utuh untuk `cat`.
WP_USER=""; WP_PASS=""
if [[ -t 0 ]]; then : > "$PLUGIN_ZIP"; else
  IFS= read -r WP_USER || true
  IFS= read -r WP_PASS || true
  cat > "$PLUGIN_ZIP"
fi
[[ -z "$WP_USER" || "$WP_USER" =~ ^[A-Za-z0-9._-]{1,60}$ ]] || fail "username admin WordPress tidak sah"

SELF_SHA="$(sha256sum "$0" | cut -d' ' -f1)"
if [[ -n "$EXPECTED_SHA" && "$EXPECTED_SHA" != "$SELF_SHA" ]]; then
  echo "OUTDATED $SELF_SHA"
  exit 3
fi

PHP_VERSION="8.3"
PHP="php${PHP_VERSION}"
WP_CLI="$(command -v wp || true)"
[[ -n "$WP_CLI" ]] || fail "WP-CLI tidak ditemukan"

# news.bispdailyupdates.pk -> bispdailyupdates-news; psaonlineappointment.com -> psaonlineappointment.
IFS=. read -ra LABELS <<< "$DOMAIN"
N=${#LABELS[@]}
if (( N <= 2 )); then
  SITE_USER="${LABELS[0]}"
else
  SUB="$(IFS=-; echo "${LABELS[*]:0:N-2}")"
  SITE_USER="${LABELS[N-2]}-${SUB}"
fi
# Judul situs = label PALING KIRI saja (1click.designingaround.com -> "1click"), karena itu yang
# digambar blok wp-block-site-title di header dan footer; nama domain penuh di sana cuma mengulang
# alamat yang sudah ada di bilah browser. Huruf pertamanya kapital ("1click" tetap, "care" -> "Care").
SITE_TITLE="${LABELS[0]^}"
SITE_USER="${SITE_USER:0:32}"
SITE_USER="${SITE_USER%-}"
SITE_ROOT="/home/${SITE_USER}/htdocs/${DOMAIN}"
CRED_DIR="/root/rabbitroi-sites"
CRED_FILE="${CRED_DIR}/${DOMAIN}.txt"

# Dijalankan DARI $SITE_ROOT, bukan dari direktori kerja SSH/root. `sudo` mewarisi cwd pemanggilnya,
# dan site user tidak bisa masuk ke home rabbitroi/root; perintah WP-CLI yang meluncurkan proses
# kedua (`rewrite structure` -> `WP_CLI::runcommand('rewrite flush')`) mengoper `getcwd()` ke
# proc_open, yang lalu gagal dan menjatuhkan run dengan "proc_close(): Argument #1 ($process) must be
# of type resource, false given" + "There has been a critical error" (21 Sep 2026,
# oneclick/1click.designingaround.com). Subshell supaya cwd skrip ini sendiri tidak ikut berpindah.
wp_as_site() { (cd "$SITE_ROOT" && sudo -u "$SITE_USER" -H "$PHP" "$WP_CLI" --path="$SITE_ROOT" "$@"); }
# Perawatan tanpa memuat plugin/tema: plugin RabbitROI memanggil jaringan (lisensi, daftar ASN) tiap
# kali dimuat, dan satu kegagalannya di sana menjatuhkan perintah WP-CLI yang tidak butuh plugin itu
# sama sekali ("There has been a critical error", 19 Sep 2026).
wp_bare() { wp_as_site --skip-plugins --skip-themes "$@"; }
rand() { openssl rand -hex 16; }

CREATED_SITE=false
INSTALLED_WP=false

# ---------- 1. Site ----------
if [[ -d "$SITE_ROOT" ]]; then
  log "site sudah ada: $SITE_ROOT"
else
  # Nama user yang sama dipakai domain LAIN berarti tebakan kita bentrok — lebih baik berhenti
  # daripada menaruh site kedua di bawah home orang lain.
  if id "$SITE_USER" &>/dev/null; then
    fail "site user $SITE_USER sudah dipakai domain lain"
  fi
  log "membuat site $DOMAIN (user $SITE_USER, PHP $PHP_VERSION)"
  SITE_PASSWORD="$(rand)"
  clpctl site:add:php \
    --domainName="$DOMAIN" \
    --phpVersion="$PHP_VERSION" \
    --vhostTemplate="WordPress" \
    --siteUser="$SITE_USER" \
    --siteUserPassword="$SITE_PASSWORD" >&2
  CREATED_SITE=true
fi

# ---------- 2. Database + WordPress ----------
if [[ -f "$SITE_ROOT/wp-config.php" ]]; then
  log "wp-config.php sudah ada, database dilewati"
else
  DB_NAME="$SITE_USER"
  DB_USER="${SITE_USER:0:32}"
  DB_PASSWORD="$(rand)"
  log "membuat database $DB_NAME"
  clpctl db:add \
    --domainName="$DOMAIN" \
    --databaseName="$DB_NAME" \
    --databaseUserName="$DB_USER" \
    --databaseUserPassword="$DB_PASSWORD" >&2

  if [[ ! -f "$SITE_ROOT/wp-includes/version.php" ]]; then
    log "mengunduh WordPress core"
    wp_as_site core download --force >&2
  fi
  wp_as_site config create \
    --dbname="$DB_NAME" --dbuser="$DB_USER" --dbpass="$DB_PASSWORD" --dbhost="127.0.0.1" \
    --dbprefix="wp_$(openssl rand -hex 3)_" --skip-check --force >&2
fi

if wp_bare core is-installed &>/dev/null; then
  log "WordPress sudah terpasang"
else
  ADMIN_USER="${WP_USER:-rabbitroi}"
  ADMIN_PASSWORD="${WP_PASS:-$(rand)}"
  log "memasang WordPress"
  wp_as_site core install \
    --url="https://${DOMAIN}" --title="$SITE_TITLE" \
    --admin_user="$ADMIN_USER" --admin_password="$ADMIN_PASSWORD" --admin_email="$ADMIN_EMAIL" \
    --skip-email >&2
  INSTALLED_WP=true
  # Kredensial TIDAK dikirim balik ke dashboard: yang keluar dari sini melewati log server kontrol
  # dan RTDB yang terbaca tiap akun yang login. Tinggal di server ini, root saja.
  install -d -m 700 "$CRED_DIR"
  umask 077
  cat > "$CRED_FILE" <<EOF
domain=$DOMAIN
site_user=$SITE_USER
site_user_password=${SITE_PASSWORD:-tidak-berubah}
db_name=${DB_NAME:-}
db_user=${DB_USER:-}
db_password=${DB_PASSWORD:-}
wp_admin=https://$DOMAIN/wp-admin
wp_admin_user=$ADMIN_USER
wp_admin_password=$ADMIN_PASSWORD
wp_admin_email=$ADMIN_EMAIL
created_at=$(date -Is)
EOF
fi

# Situs yang dipasang sebelum aturan judul di atas membawa nama domain penuh (atau label huruf kecil).
# Diganti HANYA kalau judulnya masih persis bawaan kita — judul yang sudah dipilih orang tidak ditimpa.
CURRENT_TITLE="$(wp_bare option get blogname 2>/dev/null)"
if [[ "$CURRENT_TITLE" != "$SITE_TITLE" && ( "$CURRENT_TITLE" == "$DOMAIN" || "$CURRENT_TITLE" == "${LABELS[0]}" ) ]]; then
  log "judul situs -> $SITE_TITLE"
  wp_bare option update blogname "$SITE_TITLE" >&2
fi

# Permalink "Plain" (bawaan instalasi baru) membuat /wp-json/ jatuh ke halaman depan: HTTP 200
# berisi HTML, dan enroll dari dashboard gagal dengan "Situs menjawab tanpa JSON". Hanya diset kalau
# masih kosong — struktur yang sudah dipilih orang tidak ditimpa.
if [[ -z "$(wp_bare option get permalink_structure 2>/dev/null)" ]]; then
  log "set permalink /%postname%/"
  wp_bare rewrite structure '/%postname%/' --hard >&2
fi

# ---------- 3. Plugin RabbitROI ----------
PLUGIN_DIR="$SITE_ROOT/wp-content/plugins/rabbitroi"
if [[ ! -f "$PLUGIN_DIR/rabbitroi.php" ]]; then
  # "0.4.69 /home/x/.../rabbitroi" per situs, urut versi, ambil yang tertinggi.
  PICK="$(for file in /home/*/htdocs/*/wp-content/plugins/rabbitroi/rabbitroi.php; do
    version="$(grep -m1 -oP 'Version:\s*\K[0-9.]+' "$file" 2>/dev/null || true)"
    # `if`, bukan `[[ ]] && echo`: di server tanpa satu plugin pun, iterasi terakhir berstatus 1,
    # pipefail meneruskannya, dan set -e mematikan skrip TANPA baris ERROR — jalur zip tidak pernah
    # tercapai (195.201.56.95, 22 Sep 2026).
    if [[ -n "$version" ]]; then echo "$version $(dirname "$file")"; fi
  done | sort -V | tail -1)"
  if [[ -n "$PICK" ]]; then
    BEST="${PICK%% *}"
    SOURCE="${PICK#* }"
    log "menyalin plugin RabbitROI $BEST dari $SOURCE"
    cp -a "$SOURCE" "$PLUGIN_DIR"
  else
    [[ -s "$PLUGIN_ZIP" ]] || fail "tidak ada plugin RabbitROI di server ini dan server kontrol tidak mengirim zip-nya (PLUGIN_GITHUB_TOKEN kosong?)"
    command -v unzip >/dev/null || fail "unzip tidak ada"
    log "memasang plugin RabbitROI dari zip rilis kiriman server kontrol"
    unzip -q "$PLUGIN_ZIP" -d "$TMP"
    [[ -f "$TMP/rabbitroi/rabbitroi.php" ]] || fail "zip plugin tidak berisi rabbitroi/rabbitroi.php"
    mv "$TMP/rabbitroi" "$PLUGIN_DIR"
  fi
  chown -R "$SITE_USER:$SITE_USER" "$PLUGIN_DIR"
fi
wp_bare plugin is-active rabbitroi || wp_as_site plugin activate rabbitroi >&2
PLUGIN_VERSION="$(grep -m1 -oP 'Version:\s*\K[0-9.]+' "$PLUGIN_DIR/rabbitroi.php" || true)"

clpctl system:permissions:reset --directories=770 --files=660 --path="$SITE_ROOT" >&2 || true

# ---------- 4. SSL ----------
# Gagal di sini bukan kegagalan run: DNS yang baru dibuat bisa belum terbaca Let's Encrypt. Yang
# dikabarkan `ssl: failed`, dan menekan Setup lagi mengulang langkah ini saja.
SSL="ok"
SSL_ERROR=""
if ! SSL_OUT="$(clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" 2>&1)"; then
  SSL="failed"
  SSL_ERROR="$(echo "$SSL_OUT" | tail -3 | tr '\n' ' ' | tr -d '"\\')"
fi
echo "$SSL_OUT" >&2

printf 'RESULT {"domain":"%s","siteUser":"%s","createdSite":%s,"installedWordpress":%s,"plugin":"%s","ssl":"%s","sslError":"%s","credentialsFile":"%s"}\n' \
  "$DOMAIN" "$SITE_USER" "$CREATED_SITE" "$INSTALLED_WP" "$PLUGIN_VERSION" "$SSL" "$SSL_ERROR" \
  "$( [[ -f "$CRED_FILE" ]] && echo "$CRED_FILE" )"

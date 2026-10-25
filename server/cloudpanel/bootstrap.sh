#!/usr/bin/env bash
#
# Siapkan SATU server CloudPanel untuk Setup Sub — sekali per server. Jangan dipanggil langsung:
#   server/cloudpanel/bootstrap-remote.sh <IP>
# yang menyalin kedua skrip lalu menjalankan ini sebagai root. Idempotent: menjalankannya ulang cuma
# memperbarui skripnya.
#
# Yang dipasang sama persis dengan 94.130.38.76: user `rabbitroi` tanpa password, kunci server
# kontrol DIKUNCI ke satu perintah, dan sudoers yang cuma mengizinkan skrip setup.
set -euo pipefail
PUBKEY="${1:-}"
DIR="${2:-/tmp/rabbitroi-bootstrap}"
[[ $EUID -eq 0 ]] || { echo "harus root" >&2; exit 1; }
[[ "$PUBKEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+ ]] || { echo "kunci publik ed25519 tidak sah" >&2; exit 1; }
command -v clpctl >/dev/null || { echo "clpctl tidak ada — ini bukan server CloudPanel" >&2; exit 1; }
command -v wp >/dev/null || { echo "WP-CLI tidak ada" >&2; exit 1; }
command -v php8.3 >/dev/null || { echo "PHP 8.3 tidak ada" >&2; exit 1; }

install -m 755 "$DIR/rabbitroi-setup-sub.sh" /usr/local/sbin/rabbitroi-setup-sub
install -m 755 "$DIR/rabbitroi-setup-sub-ssh.sh" /usr/local/sbin/rabbitroi-setup-sub-ssh

id rabbitroi >/dev/null 2>&1 || useradd -m -s /bin/bash rabbitroi
echo 'rabbitroi ALL=(root) NOPASSWD: /usr/local/sbin/rabbitroi-setup-sub' > /etc/sudoers.d/rabbitroi-setup-sub
chmod 440 /etc/sudoers.d/rabbitroi-setup-sub
visudo -c >/dev/null

install -d -m 700 -o rabbitroi -g rabbitroi ~rabbitroi/.ssh
KEYS=~rabbitroi/.ssh/authorized_keys
LINE="restrict,command=\"/usr/local/sbin/rabbitroi-setup-sub-ssh\" $PUBKEY"
touch "$KEYS"
grep -qxF "$LINE" "$KEYS" || echo "$LINE" >> "$KEYS"
chown rabbitroi:rabbitroi "$KEYS"; chmod 600 "$KEYS"

# Token GitHub tidak lagi tinggal di server CloudPanel (zip plugin dikirim server kontrol lewat SSH);
# sisa dari versi sebelumnya dibuang.
rm -f /root/rabbitroi-github-token
command -v unzip >/dev/null || apt-get install -y -qq unzip >/dev/null
rm -rf /tmp/rabbitroi-bootstrap
echo "OK $(hostname)"

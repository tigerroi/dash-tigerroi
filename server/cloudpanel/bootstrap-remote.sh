#!/usr/bin/env bash
# Pakai: server/cloudpanel/bootstrap-remote.sh <IP> [user-ssh-root, bawaan root]
# Menyalin skrip setup ke server CloudPanel lalu menjalankan bootstrap.sh di sana dengan kunci
# publik server kontrol. Butuh akses root (atau user ber-sudo) ke server itu dari mesin ini.
set -euo pipefail
IP="$1"; USER_AT="${2:-root}@$IP"
SSH_KEY_PUB="${SETUP_SUB_SSH_PUB_KEY:-/opt/tigerroi-control/ssh/tigerroi_setup_sub.pub}"
CONTROL_HOST="${CONTROL_HOST:-}"

if [[ -f "$SSH_KEY_PUB" ]]; then
  PUB="$(cat "$SSH_KEY_PUB")"
elif [[ -n "$CONTROL_HOST" ]]; then
  PUB="$(ssh "root@$CONTROL_HOST" cat "$SSH_KEY_PUB")"
else
  echo "ERROR: File kunci publik $SSH_KEY_PUB tidak ada secara lokal dan variabel CONTROL_HOST tidak diisi." >&2
  echo "       Setel CONTROL_HOST=<ip_server_kontrol> atau pastikan kunci publik ada di $SSH_KEY_PUB." >&2
  exit 1
fi

ssh "$USER_AT" 'mkdir -p /tmp/rabbitroi-bootstrap'
scp -q "$HERE/rabbitroi-setup-sub.sh" "$HERE/rabbitroi-setup-sub-ssh.sh" "$HERE/bootstrap.sh" "$USER_AT:/tmp/rabbitroi-bootstrap/"
ssh -t "$USER_AT" "sudo bash /tmp/rabbitroi-bootstrap/bootstrap.sh '$PUB'"

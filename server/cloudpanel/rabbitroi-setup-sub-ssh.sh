#!/usr/bin/env bash
# Forced command untuk kunci SSH server kontrol (authorized_keys `command="..."`).
#
# Kunci itu TIDAK membuka shell: yang bisa dijalankannya cuma skrip setup, dengan dua argumen yang
# diperiksa ketat di sana. `set -f` mematikan glob, jadi "*" di SSH_ORIGINAL_COMMAND tetap "*" dan
# ditolak pola domain alih-alih berubah jadi daftar berkas.
set -f
# shellcheck disable=SC2086
exec sudo -n /usr/local/sbin/rabbitroi-setup-sub $SSH_ORIGINAL_COMMAND

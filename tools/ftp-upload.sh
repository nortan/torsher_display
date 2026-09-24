#!/usr/bin/env bash
# Выгрузка папки на FTP (для .github/workflows/deploy-ftp.yml): tools/ftp-upload.sh <папка> <удалённая папка>
# Переменные: FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_SSL_VERIFY (yes|no).
# Лишние файлы на сервере не удаляются (uploads/ с фото остаётся), меняются только новые и изменённые.
set -euo pipefail
src=${1:?папка}
dst=${2:-/}
lftp -c "
set cmd:fail-exit yes
set net:max-retries 3
set net:timeout 30
set ftp:ssl-allow yes
set ssl:verify-certificate ${FTP_SSL_VERIFY:-yes}
open -u \"$FTP_USER\",\"$FTP_PASSWORD\" \"$FTP_HOST\"
cls -1 \"$dst\" | head -20
mirror -R --only-newer --no-perms --parallel=4 --verbose=1 \"$src\" \"$dst\"
"

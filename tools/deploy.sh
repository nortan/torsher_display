#!/usr/bin/env bash
# Выгрузка статической сборки на сервер по SSH (rsync).
#   DEPLOY_TARGET=user@host:/var/www/torsher-display tools/deploy.sh
# Экран на сервере подхватит новые данные сам, а при смене версии (build.json) перезагрузится.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_TARGET:?Укажите DEPLOY_TARGET=user@host:/путь/к/сайту}"
node tools/build.mjs ${WITH_ADMIN:+--with-admin}
# build.json и данные выгружаем последними, чтобы экран не увидел новую версию раньше файлов
rsync -az --delete --exclude build.json --exclude content/ dist/ "$DEPLOY_TARGET/"
rsync -az dist/content/ "$DEPLOY_TARGET/content/"
rsync -az dist/build.json "$DEPLOY_TARGET/build.json"
echo "Готово: $DEPLOY_TARGET"

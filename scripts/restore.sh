#!/bin/bash
# استعادة نسخة احتياطية. الاستخدام: scripts/restore.sh /var/backups/gp-erp/20261017-023000
# تحذير: يستبدل قاعدة البيانات ومجلد الملفات الحاليين بالكامل. أوقف الخدمة أولًا: systemctl stop gp-erp
set -euo pipefail
SRC="${1:?حدد مجلد النسخة}"
STORAGE="${STORAGE_DIR:-./storage}"
DB_URL="${DATABASE_URL%%\?*}"
( cd "$SRC" && sha256sum -c SHA256SUMS ) || { echo "✗ فشل التحقق من سلامة النسخة"; exit 1; }
if [ "${CONFIRM:-}" != "yes" ]; then read -r -p "سيتم استبدال البيانات الحالية بنسخة $SRC. اكتب yes للمتابعة: " a; [ "$a" = "yes" ] || exit 1; fi
pg_restore --clean --if-exists --no-owner --single-transaction --dbname="$DB_URL" "$SRC/db.dump"
if [ -d "$STORAGE" ]; then mv "$STORAGE" "$STORAGE.before-restore-$(date +%s)"; fi
mkdir -p "$(dirname "$STORAGE")" && tar -xzf "$SRC/storage.tar.gz" -C "$(dirname "$STORAGE")"
echo "✓ تمت الاستعادة من $SRC — شغّل الخدمة: systemctl start gp-erp"

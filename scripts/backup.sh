#!/bin/bash
# نسخ احتياطي: قاعدة البيانات (pg_dump بصيغة custom) + مجلد الملفات، مع الاحتفاظ بعدد أيام محدد.
# المتغيرات: DATABASE_URL, STORAGE_DIR, BACKUP_DIR (افتراضي /var/backups/gp-erp), BACKUP_KEEP_DAYS (افتراضي 30)
# اختياري: BACKUP_REMOTE (وجهة rsync خارج الخادم، مثل user@nas:/backups/gp-erp) — نسخة خارجية ضرورية للتعافي من الكوارث.
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gp-erp}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
STORAGE="${STORAGE_DIR:-./storage}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
DB_URL="${DATABASE_URL%%\?*}"   # إزالة ?schema=public لأن pg_dump لا يقبلها
mkdir -p "$DEST"
umask 077
pg_dump --format=custom --no-owner --dbname="$DB_URL" --file="$DEST/db.dump"
tar -czf "$DEST/storage.tar.gz" -C "$(dirname "$STORAGE")" "$(basename "$STORAGE")"
( cd "$DEST" && sha256sum db.dump storage.tar.gz > SHA256SUMS )
# تحقق أن النسخة قابلة للقراءة
pg_restore --list "$DEST/db.dump" > /dev/null
echo "✓ backup $DEST ($(du -sh "$DEST" | cut -f1))"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP" -exec rm -rf {} +
if [ -n "${BACKUP_REMOTE:-}" ]; then rsync -a --delete "$BACKUP_DIR/" "$BACKUP_REMOTE/" && echo "✓ نُسخت خارجيًا إلى $BACKUP_REMOTE"; fi

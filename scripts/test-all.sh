#!/bin/bash
# تشغيل كل الاختبارات على قاعدة بيانات اختبار نظيفة (لا تشغّله على قاعدة الإنتاج!)
set -e
cd "$(dirname "$0")/.."
echo "== اختبارات الوحدة"; npx vitest run 2>&1 | grep -E "Tests|passed|failed"
echo "== إعادة تهيئة قاعدة الاختبار"; npx tsx scripts/sql-bootstrap.ts
SEED_DEMO=true npx tsx prisma/seed.ts | grep device= | sed 's/.*device=//' > /tmp/token
# حسابات الاختبار: إلغاء إجبار تغيير كلمة المرور عدا "ops" لاختبار المسار نفسه
npx tsx scripts/test-helpers.ts test-accounts
echo "== السيناريو التشغيلي"; NODE_NO_WARNINGS=1 npx tsx scripts/scenario.ts | tail -3
echo "== مسار إعادة الإنتاج"; NODE_NO_WARNINGS=1 npx tsx scripts/rework.ts | tail -1

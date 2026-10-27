/**
 * تشغيل الفحوصات الدورية محليًا مباشرة (بدون cron ولا CRON_SECRET):
 * قرب موعد التسليم (DUE_SOON) والتأخر (ORDER_LATE). آمن للتكرار: لا يكرر إشعار اليوم نفسه.
 * تشغيل: npm run checks
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { runScheduledChecks } from "../src/server/services/scheduler";

runScheduledChecks()
  .then((r) => console.log(`✓ الفحوصات الدورية: قرب موعد التسليم ${r.dueSoon} — طلبات تأخرت الآن ${r.newlyLate}`))
  .catch((e) => { console.error("✗", e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());

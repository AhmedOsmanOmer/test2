/** أدوات مساعدة لبيئة الاختبار فقط */
import "dotenv/config";
import { db } from "../src/lib/db";
const cmd = process.argv[2];
(async () => {
  if (cmd === "counts") console.log("users:", await db.user.count(), "machines:", await db.machine.count(), "orders:", await db.order.count(), "roles:", await db.role.count(), "permissions:", await db.permission.count());
  if (cmd === "test-accounts") await db.user.updateMany({ where: { username: { not: "ops" } }, data: { mustChangePassword: false } });
  await db.$disconnect();
})();

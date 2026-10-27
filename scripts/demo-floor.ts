/**
 * بيانات تشغيل تجريبية لاختبار شاشة الإنتاج المباشر واللوحة فقط — كل الأسماء تحمل "(تجريبي)".
 * لا تُشغَّل على قاعدة بيانات الإنتاج الفعلية.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db } from "../src/lib/db";
import { loadActor } from "../src/server/actor";
import { createCustomer } from "../src/server/services/customers";
import { createOrder, setDepositReceived } from "../src/server/services/orders";
import { createProductionOrder, startProduction, logProgress, completeStage } from "../src/server/services/production";

const as = async (u: string) => (await loadActor((await db.user.findUniqueOrThrow({ where: { username: u } })).id))!;
(async () => {
  if (process.env.NODE_ENV === "production") throw new Error("ممنوع على بيئة الإنتاج");
  const [sales, salessup, sup] = await Promise.all(["sales", "salessup", "supervisor"].map(as));
  const workers = await db.user.findMany({ where: { username: { in: ["worker", "worker2", "supervisor"] } } });
  const machines = await db.machine.findMany({ orderBy: { code: "asc" } });
  const h = (x: number) => new Date(Date.now() + x * 3600_000);
  const jobs = [
    { c: "(تجريبي) مطعم البيت الشامي", p: "منيو مطبوع A4 مقوى", q: 500, m: 0, s: -2, e: 3, done: 300, pr: "NORMAL", start: true },
    { c: "(تجريبي) معرض الواحة للسيارات", p: "بنر فينيل 6×3 م", q: 4, m: 5, s: -3, e: -0.5, done: 1, pr: "HIGH", start: true },
    { c: "(تجريبي) شركة نخبة العقار", p: "لوحة UV مسطحة", q: 12, m: 1, s: -1, e: 1, done: 2, pr: "URGENT", start: true },
    { c: "(تجريبي) متجر لمسة هدايا", p: "أكواب مطبوعة DTF UV", q: 300, m: 2, s: 2, e: 6, done: 0, pr: "NORMAL", start: false },
    { c: "(تجريبي) مركز رعاية الأسنان", p: "كروت مواعيد", q: 2000, m: 3, s: 4, e: 6, done: 0, pr: "URGENT", start: false },
  ] as const;
  for (const j of jobs) {
    const c = await createCustomer(sales, { name: j.c, type: "COMPANY" });
    const o = await createOrder(sales, { customerId: c.id, dueDate: h(j.e + 2), priority: j.pr, requiresDesign: false, total: j.q * 10, items: [{ name: j.p, quantity: j.q, unit: "قطعة" }] });
    await db.order.update({ where: { id: o.id }, data: { status: "AWAITING_DEPOSIT" } });
    await setDepositReceived(salessup, o.id, true);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    const po = await createProductionOrder(sup, { orderId: o.id, orderItemId: item.id, quantity: j.q, machineId: machines[j.m].id, assigneeId: workers[jobs.indexOf(j) % workers.length].id, priority: j.pr, plannedStart: h(j.s), plannedEnd: h(j.e), stages: ["تجهيز الملفات", "الطباعة", "القص", "التغليف"] });
    if (j.start) {
      await startProduction(sup, po.id);
      const st = await db.productionStage.findFirstOrThrow({ where: { productionOrderId: po.id, sequence: 1 } });
      await completeStage(sup, st.id);
      if (j.done) await logProgress(sup, { productionOrderId: po.id, goodQty: j.done, scrapQty: 0, idempotencyKey: randomUUID() });
    }
  }
  console.log("✓ تم إنشاء بيانات أرضية تجريبية: 3 قيد التنفيذ (أحدها متأخر) و2 مجدولة");
  await db.$disconnect();
})().catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });

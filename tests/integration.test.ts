/**
 * اختبارات تكامل على قاعدة بيانات الاختبار فقط (تتطلب seed تجريبيًا: SEED_DEMO=true).
 * تعمل فقط عند ضبط TEST_DATABASE_URL على المنفذ 5434؛ غير ذلك تُتخطى فيبقى `npm test` أخضر.
 *   TEST_DATABASE_URL="postgresql://…@127.0.0.1:5434/…" npm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const enabled = !!url && new URL(url).port === "5434";

describe.skipIf(!enabled)("تكامل: نطاق الطلبات وعدم تسريب المال (قاعدة الاختبار 5434)", () => {
  type Svc = typeof import("@/server/services/orders");
  let db: typeof import("@/lib/db").db;
  let orders: Svc;
  let access: typeof import("@/server/services/access");
  let A: Record<string, import("@/server/actor").Actor>;
  let oA: { id: string; number: string }, oB: { id: string; number: string };
  const AMOUNTS = ["5000", "5,000", "٥٬٠٠٠", "2500", "2,500", "٢٬٥٠٠", "7000", "7,000"];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    orders = await import("@/server/services/orders");
    access = await import("@/server/services/access");
    const { loadActor } = await import("@/server/actor");
    const { createCustomer } = await import("@/server/services/customers");
    A = {};
    for (const u of ["admin", "salessup", "sales", "sales2", "ops", "designer", "worker", "qc", "delivery"]) {
      const user = await db.user.findUnique({ where: { username: u } });
      if (!user) throw new Error(`المستخدم ${u} غير موجود — شغّل SEED_DEMO=true على قاعدة الاختبار`);
      A[u] = (await loadActor(user.id))!;
    }
    const c = await createCustomer(A.sales, { name: `(اختبار تكامل) عميل ${Date.now()}`, type: "COMPANY" });
    const due = new Date(Date.now() + 5 * 86400_000);
    oA = await orders.createOrder(A.sales, { customerId: c.id, dueDate: due, total: 5000, items: [{ name: "لوحة", quantity: 2 }] });
    oB = await orders.createOrder(A.sales2, { customerId: c.id, dueDate: due, total: 7000, items: [{ name: "بنر", quantity: 1 }] });
  }, 60_000);
  afterAll(async () => { await db?.$disconnect(); });

  it("مبيعات A لا يفتح طلب مبيعات B", async () => {
    await expect(access.assertOrderAccess(A.sales, oB.id)).rejects.toThrow("الطلب غير موجود");
    await expect(access.assertOrderAccess(A.sales2, oB.id)).resolves.toBeTruthy();
    await expect(access.assertOrderAccess(A.ops, oB.id)).resolves.toBeTruthy();
  });

  it("مبيعات A لا يرى طلب B في القائمة ولا في البحث", async () => {
    const list = await db.order.findMany({ where: access.orderScope(A.sales), select: { id: true } });
    expect(list.map((o) => o.id)).toContain(oA.id);
    expect(list.map((o) => o.id)).not.toContain(oB.id);
    // نفس شرط صفحة البحث
    const found = await db.order.findMany({ where: { ...access.orderScope(A.sales), OR: [{ number: { contains: oB.number, mode: "insensitive" } }] } });
    expect(found).toHaveLength(0);
  });

  it("مبيعات A لا يتصرف في طلب B", async () => {
    await expect(orders.changeStatus(A.sales, oB.id, "REVIEW")).rejects.toThrow("الطلب غير موجود");
    await expect(orders.setOrderMoney(A.sales, oB.id, { total: 1 })).rejects.toThrow("الطلب غير موجود");
    await expect(orders.addComment(A.sales, oB.id, "x")).rejects.toThrow("الطلب غير موجود");
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: oB.id } });
    await expect(orders.cancelItemQty(A.salessup, item.id, 1, "x")).rejects.toThrow(/صلاحية/);
  });

  it("قواعد setOrderMoney", async () => {
    await expect(orders.setOrderMoney(A.ops, oA.id, { total: 1 })).rejects.toThrow(/صلاحية/);
    await expect(orders.setOrderMoney(A.designer, oA.id, { total: 1 })).rejects.toThrow(/صلاحية/);
    await expect(orders.setOrderMoney(A.sales, oA.id, { paidAmount: 6000 })).rejects.toThrow("المبلغ المدفوع لا يمكن أن يتجاوز قيمة الطلب");
    await expect(orders.setOrderMoney(A.sales, oA.id, { total: -5 })).rejects.toThrow();
    await expect(orders.setOrderMoney(A.sales, oA.id, { total: 5000 })).rejects.toThrow("لم يتغير شيء");
    const v = (await db.order.findUniqueOrThrow({ where: { id: oA.id } })).version;
    await orders.setOrderMoney(A.sales, oA.id, { paidAmount: 2500, expectedVersion: v });
    await expect(orders.setOrderMoney(A.sales, oA.id, { paidAmount: 2600, expectedVersion: v })).rejects.toThrow(/مستخدم آخر/);
    await orders.setOrderMoney(A.salessup, oB.id, { paidAmount: 100 });
    const a = await db.order.findUniqueOrThrow({ where: { id: oA.id } });
    expect(Number(a.paidAmount)).toBe(2500);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: oA.id, action: "ORDER_MONEY" }, orderBy: { createdAt: "desc" } });
    expect(log.after).toEqual({ total: 5000, paidAmount: 2500 });
  });

  it("تأكيد الدفعة ينقل الطلب بلا تجاوز، ولمن يملك الصلاحية فقط", async () => {
    for (const s of ["REVIEW", "AWAITING_CUSTOMER_APPROVAL", "AWAITING_DEPOSIT"] as const) await orders.changeStatus(A.sales, oA.id, s);
    await expect(orders.changeStatus(A.admin, oA.id, "AWAITING_DESIGN", "استثناء")).rejects.toThrow("لم يتم تأكيد استلام الدفعة المقدمة بعد");
    await expect(orders.setDepositReceived(A.sales, oA.id, true)).rejects.toThrow(/صلاحية/);
    await orders.setDepositReceived(A.salessup, oA.id, true);
    expect((await db.order.findUniqueOrThrow({ where: { id: oA.id } })).status).toBe("AWAITING_DESIGN");
  });

  it("المصمم والعامل ومدير العمليات لا يحصلون على حقل مال، ولا مبالغ في السجل الزمني أو الإشعارات", async () => {
    const o = await db.order.findUniqueOrThrow({ where: { id: oA.id } });
    for (const u of ["designer", "worker", "ops", "qc", "delivery"]) expect(access.orderMoneyView(A[u], o)).toBeNull();
    expect(access.orderMoneyView(A.admin, o)).toEqual({ total: 5000, paidAmount: 2500, remaining: 2500 });
    const events = await db.orderEvent.findMany({ where: { orderId: { in: [oA.id, oB.id] } }, select: { message: true } });
    const notes = await db.notification.findMany({ where: { link: { in: [`/orders/${oA.id}`, `/orders/${oB.id}`] } }, select: { title: true, body: true } });
    const text = [...events.map((e) => e.message), ...notes.flatMap((n) => [n.title, n.body ?? ""])].join("\n");
    expect(events.length).toBeGreaterThan(4);
    for (const a of AMOUNTS) expect(text).not.toContain(a);
  });
});

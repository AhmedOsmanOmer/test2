/** تكامل أحداث الإشعارات والإجراءين الجديدين — يعمل فقط مع TEST_DATABASE_URL على المنفذ 5434 (بعد seed تجريبي) */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const enabled = !!url && new URL(url).port === "5434";

describe.skipIf(!enabled)("تكامل: أحداث الإشعارات", () => {
  let db: typeof import("@/lib/db").db;
  let orders: typeof import("@/server/services/orders");
  let A: Record<string, import("@/server/actor").Actor>;
  let oA: { id: string; number: string };
  const T0 = new Date();
  const MONEY = ["9100", "9,100", "٩٬١٠٠", "4550", "4,550", "٤٬٥٥٠", "ريال", "ر.س", "SAR"];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    orders = await import("@/server/services/orders");
    const { loadActor } = await import("@/server/actor");
    const { createCustomer } = await import("@/server/services/customers");
    A = {};
    for (const u of ["admin", "salessup", "sales", "sales2", "ops", "designer", "worker", "supervisor"]) A[u] = (await loadActor((await db.user.findUniqueOrThrow({ where: { username: u } })).id))!;
    const c = await createCustomer(A.sales, { name: `(اختبار إشعارات) ${Date.now()}`, type: "COMPANY" });
    oA = await orders.createOrder(A.ops, { customerId: c.id, salesRepId: A.sales.id, dueDate: new Date(Date.now() + 6 * 86400_000), total: undefined, items: [{ name: "لوحة", quantity: 3 }] });
  }, 60_000);
  afterAll(async () => { await db?.$disconnect(); });

  const usersOf = async (type: string, since = T0) =>
    (await db.notification.findMany({ where: { orderId: oA.id, type, createdAt: { gte: since } }, select: { user: { select: { username: true } } } })).map((n) => n.user.username).sort();

  it("ORDER_NEW: الإدارة ومشرف المبيعات والمندوب (لأن المنشئ غيره)، وليس المنشئ", async () => {
    const u = await usersOf("ORDER_NEW");
    expect(u).toEqual(expect.arrayContaining(["admin", "salessup", "sales"]));
    expect(u).not.toContain("ops");
    expect(u).not.toContain("sales2");
  });

  it("تغيير الحالة: المندوب والعمليات ومشرف المبيعات، دون المنفّذ؛ والاستثنائية مهمة وتصل للمدير", async () => {
    const t = new Date();
    await orders.setOrderMoney(A.sales, oA.id, { total: 9100 });
    await orders.changeStatus(A.sales, oA.id, "REVIEW");
    expect(await usersOf("ORDER_STATUS_CHANGED", t)).toEqual(["ops", "salessup"].sort());
    const t2 = new Date();
    await orders.changeStatus(A.ops, oA.id, "ON_HOLD", "بانتظار ملف الشعار");
    const n = await db.notification.findMany({ where: { orderId: oA.id, type: "ORDER_STATUS_CHANGED", createdAt: { gte: t2 } }, include: { user: { select: { username: true } } } });
    expect(n.map((x) => x.user.username).sort()).toEqual(["admin", "sales", "salessup"]);
    expect(n.every((x) => x.isImportant && x.title === `الطلب ${oA.number}: مراجعة الطلب ← معلق` && x.body === "بانتظار ملف الشعار")).toBe(true);
    await orders.changeStatus(A.ops, oA.id, "REVIEW");
  });

  it("تأكيد الدفعة + الانتقال الآلي: إشعار واحد لكل مستخدم (الأخص يغلب العام)", async () => {
    await orders.changeStatus(A.sales, oA.id, "AWAITING_CUSTOMER_APPROVAL");
    await orders.changeStatus(A.sales, oA.id, "AWAITING_DEPOSIT");
    await orders.setOrderMoney(A.sales, oA.id, { paidAmount: 4550 });
    const t = new Date();
    await orders.setDepositReceived(A.salessup, oA.id, true);
    const n = await db.notification.findMany({ where: { orderId: oA.id, createdAt: { gte: t } }, include: { user: { select: { username: true } } } });
    const per = n.reduce<Record<string, string[]>>((m, x) => ((m[x.user.username] ??= []).push(x.type), m), {});
    // كل حدث مرة واحدة لكل مستخدم، والإشعار العام لتغيير الحالة لا يتكرر مع الأخص
    expect(per.sales.sort()).toEqual(["DEPOSIT_RECEIVED", "ORDER_AWAITING_DESIGN"]);
    expect(per.ops.sort()).toEqual(["DEPOSIT_RECEIVED", "ORDER_AWAITING_DESIGN"]);
    expect(n.some((x) => x.type === "ORDER_STATUS_CHANGED" && ["sales", "ops"].includes(x.user.username))).toBe(false);
    expect(n.filter((x) => x.type === "ORDER_STATUS_CHANGED").map((x) => x.user.username)).toEqual([]);
    expect(per.salessup).toBeUndefined(); // المنفّذ
    expect(per.sales2).toBeUndefined();
  });

  it("تغيير موعد التسليم: سبب إلزامي، لا تاريخ ماضٍ، قفل الإصدار، سجل وإشعار", async () => {
    const o = await db.order.findUniqueOrThrow({ where: { id: oA.id } });
    const d = new Date(Date.now() + 9 * 86400_000);
    await expect(orders.changeDueDate(A.sales, oA.id, d, " ")).rejects.toThrow("اذكر سبب تغيير موعد التسليم");
    await expect(orders.changeDueDate(A.sales, oA.id, new Date(Date.now() - 2 * 86400_000), "تأخير")).rejects.toThrow("موعد التسليم لا يمكن أن يكون في الماضي");
    await expect(orders.changeDueDate(A.sales2, oA.id, d, "x")).rejects.toThrow("الطلب غير موجود");
    await expect(orders.changeDueDate(A.designer, oA.id, d, "x")).rejects.toThrow(/صلاحية/);
    await expect(orders.changeDueDate(A.sales, oA.id, d, "طلب العميل", o.version - 1)).rejects.toThrow(/مستخدم آخر/);
    const t = new Date();
    await orders.changeDueDate(A.sales, oA.id, d, "طلب العميل", o.version);
    expect(await usersOf("ORDER_DUE_CHANGED", t)).toEqual(expect.arrayContaining(["ops", "salessup"]));
    expect(await usersOf("ORDER_DUE_CHANGED", t)).not.toContain("sales");
    expect(await db.auditLog.count({ where: { entityId: oA.id, action: "ORDER_DUE_CHANGE" } })).toBe(1);
    expect(await db.orderEvent.count({ where: { orderId: oA.id, type: "DUE_DATE_CHANGED" } })).toBe(1);
  });

  it("تغيير المندوب: orders.reassign فقط، مندوب صالح، المندوبان والعمليات يُشعَرون", async () => {
    await expect(orders.reassignSalesRep(A.ops, oA.id, A.sales2.id, "x")).rejects.toThrow(/صلاحية/);
    await expect(orders.reassignSalesRep(A.salessup, oA.id, A.designer.id, "x")).rejects.toThrow(/نشطًا بدور مبيعات/);
    await expect(orders.reassignSalesRep(A.salessup, oA.id, A.sales2.id, "")).rejects.toThrow(/سبب/);
    const t = new Date();
    await orders.reassignSalesRep(A.salessup, oA.id, A.sales2.id, "إجازة الموظف");
    expect((await db.order.findUniqueOrThrow({ where: { id: oA.id } })).salesRepId).toBe(A.sales2.id);
    expect(await usersOf("ORDER_REP_CHANGED", t)).toEqual(["ops", "sales", "sales2"]);
    // بعد النقل: المندوب السابق لم يعد يصل للطلب، والجديد يصل
    const { assertOrderAccess } = await import("@/server/services/access");
    await expect(assertOrderAccess(A.sales, oA.id)).rejects.toThrow("الطلب غير موجود");
    await expect(assertOrderAccess(A.sales2, oA.id)).resolves.toBeTruthy();
  });

  it("التعليق: المندوب والمكلّفون عدا الكاتب، ونص التعليق لا يُنسخ للإشعار", async () => {
    const t = new Date();
    await orders.addComment(A.ops, oA.id, "العميل سيدفع 9100 ريال غدًا");
    const n = await db.notification.findMany({ where: { orderId: oA.id, type: "ORDER_COMMENT", createdAt: { gte: t } }, include: { user: { select: { username: true } } } });
    expect(n.map((x) => x.user.username)).toEqual(["sales2"]);
    expect(n[0].title).not.toMatch(/9100|ريال/);
  });

  it("موظف مبيعات لا يستلم أي إشعار عن طلب غيره، ولا مبالغ في أي إشعار أو حدث", async () => {
    const all = await db.notification.findMany({ where: { orderId: oA.id }, include: { user: { select: { username: true } } } });
    // sales كان المندوب حتى النقل؛ sales3 لم يكن يومًا
    expect(all.some((x) => x.user.username === "sales3")).toBe(false);
    const events = await db.orderEvent.findMany({ where: { orderId: oA.id }, select: { message: true } });
    const text = [...all.flatMap((x) => [x.title, x.body ?? ""]), ...events.map((e) => e.message)].join("\n");
    for (const m of MONEY) expect(text).not.toContain(m);
  });
});

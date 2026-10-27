/** تكامل استيراد البنود من Excel — يعمل فقط مع TEST_DATABASE_URL على المنفذ 5434 (بعد seed تجريبي) */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";

const url = process.env.TEST_DATABASE_URL;
const enabled = !!url && new URL(url).port === "5434";

async function xlsx(rows: unknown[][], head = ["اسم المنتج*", "الكمية*", "الخامة"]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("بنود");
  ws.addRow(head); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe.skipIf(!enabled)("تكامل: استيراد بنود الطلب من Excel", () => {
  let db: typeof import("@/lib/db").db;
  let svc: typeof import("@/server/services/item-import");
  let orders: typeof import("@/server/services/orders");
  let A: Record<string, import("@/server/actor").Actor>;
  let oA: { id: string; number: string }, oProd: { id: string };
  let goodFile: Buffer;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    svc = await import("@/server/services/item-import");
    orders = await import("@/server/services/orders");
    const { loadActor } = await import("@/server/actor");
    const { createCustomer } = await import("@/server/services/customers");
    A = {};
    for (const u of ["admin", "salessup", "sales", "sales2", "ops", "designer"]) A[u] = (await loadActor((await db.user.findUniqueOrThrow({ where: { username: u } })).id))!;
    const c = await createCustomer(A.sales, { name: `(اختبار استيراد) ${Date.now()}`, type: "COMPANY" });
    const due = new Date(Date.now() + 7 * 86400_000);
    oA = await orders.createOrder(A.sales, { customerId: c.id, dueDate: due, total: 7300, items: [{ name: "بند أصلي", quantity: 5, material: "كرتون" }] });
    oProd = (await db.order.findFirstOrThrow({ where: { status: "IN_PRODUCTION", salesRepId: A.sales.id } }));
    goodFile = await xlsx([["بروشور", "١٢٠٠", "كوشيه"], ["بند أصلي", 5, "كرتون"], [], ["ملصق", 300, ""]]);
  }, 60_000);
  afterAll(async () => { await db?.$disconnect(); });
  const items = (id: string) => db.orderItem.count({ where: { orderId: id } });

  it("معاينة ثم تأكيد بواسطة مشرف المبيعات: البنود تُضاف، وسجل تدقيق وحدث وإشعار للمندوب", async () => {
    const p = await svc.previewOrderImport(A.salessup, oA.id, { name: "بنود.xlsx", bytes: goodFile });
    expect(p.canConfirm).toBe(true);
    expect(p.totalRows).toBe(3);
    expect(p.validRows.map((r) => r.data.quantity)).toEqual([1200, 5, 300]);
    expect(p.warnings).toEqual([{ row: 3, message: "مطابق لبند موجود في الطلب «بند أصلي»" }]);
    expect(await items(oA.id)).toBe(1); // المعاينة لا تضيف شيئًا
    const rec = await db.orderItemImport.findUniqueOrThrow({ where: { id: p.importId! } });
    expect(rec).toMatchObject({ status: "PREVIEW", fileName: "بنود.xlsx", sizeBytes: goodFile.length, totalRows: 3 });

    const r = await svc.confirmOrderImport(A.salessup, p.importId!);
    expect(r.count).toBe(3);
    expect(await items(oA.id)).toBe(4);
    const added = await db.orderItem.findMany({ where: { orderId: oA.id }, orderBy: { sortOrder: "asc" }, select: { name: true, sortOrder: true } });
    expect(added.map((x) => x.name)).toEqual(["بند أصلي", "بروشور", "بند أصلي", "ملصق"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "IMPORT_ORDER_ITEMS", entityId: oA.id } });
    expect(log.after).toEqual({ importId: p.importId, orderId: oA.id, count: 3, fileSha256: rec.fileSha256 });
    expect(await db.orderEvent.count({ where: { orderId: oA.id, type: "ITEMS_IMPORTED", message: "تم استيراد 3 بنداً من ملف Excel" } })).toBe(1);
    const n = await db.notification.findMany({ where: { orderId: oA.id, type: "ITEMS_IMPORTED" }, include: { user: { select: { username: true } } } });
    expect(n.map((x) => x.user.username)).toEqual(["sales"]);
    expect((await db.orderItemImport.findUniqueOrThrow({ where: { id: p.importId! } })).status).toBe("COMMITTED");
  });

  it("التأكيد مرتين (أو متزامنًا) لا يكرر البنود", async () => {
    const p = await svc.previewOrderImport(A.sales, oA.id, { name: "ب.xlsx", bytes: await xlsx([["لوحة", 2, ""]]) });
    const before = await items(oA.id);
    const res = await Promise.allSettled([svc.confirmOrderImport(A.sales, p.importId!), svc.confirmOrderImport(A.sales, p.importId!)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    await expect(svc.confirmOrderImport(A.sales, p.importId!)).rejects.toThrow("تم استيراد هذا الملف مسبقًا");
    expect(await items(oA.id)).toBe(before + 1);
  });

  it("نفس الملف المستورد سابقًا يحتاج تأكيدًا صريحًا", async () => {
    const p = await svc.previewOrderImport(A.salessup, oA.id, { name: "بنود.xlsx", bytes: goodFile });
    expect(p.duplicateFile).toBe(true);
    await expect(svc.confirmOrderImport(A.salessup, p.importId!)).rejects.toThrow(/استُورد سابقًا/);
    await expect(svc.confirmOrderImport(A.salessup, p.importId!, { acceptDuplicateFile: true })).resolves.toMatchObject({ count: 3 });
  });

  it("كل شيء أو لا شيء: ملف فيه خطأ لا يمكن تأكيده", async () => {
    const p = await svc.previewOrderImport(A.sales, oA.id, { name: "خطأ.xlsx", bytes: await xlsx([["صالح", 3, ""], ["", 0, ""]]) });
    expect(p.canConfirm).toBe(false);
    expect(p.errors.map((e) => [e.row, e.column, e.message])).toEqual([[3, "اسم المنتج", "اسم المنتج مطلوب"], [3, "الكمية", "الكمية يجب أن تكون أكبر من صفر"]]);
    const before = await items(oA.id);
    await expect(svc.confirmOrderImport(A.sales, p.importId!)).rejects.toThrow(/أخطاء/);
    expect(await items(oA.id)).toBe(before);
  });

  it("عمود مالي يرفض الملف دون أي سجل", async () => {
    const n0 = await db.orderItemImport.count();
    const p = await svc.previewOrderImport(A.sales, oA.id, { name: "سعر.xlsx", bytes: await xlsx([["أ", 1, 50]], ["اسم المنتج", "الكمية", "سعر الوحدة"]) });
    expect(p.fileError).toContain("عمودًا ماليًا");
    expect(p.importId).toBeNull();
    expect(await db.orderItemImport.count()).toBe(n0);
  });

  it("مبيعات B لا يعاين ولا يؤكد في طلب مبيعات A", async () => {
    await expect(svc.previewOrderImport(A.sales2, oA.id, { name: "x.xlsx", bytes: goodFile })).rejects.toThrow("الطلب غير موجود");
    const p = await svc.previewOrderImport(A.sales, oA.id, { name: "x.xlsx", bytes: await xlsx([["بند ب", 1, ""]]) });
    await expect(svc.confirmOrderImport(A.sales2, p.importId!)).rejects.toThrow("المعاينة غير موجودة");
    await svc.cancelOrderImport(A.sales, p.importId!);
    expect((await db.orderItemImport.findUniqueOrThrow({ where: { id: p.importId! } })).status).toBe("CANCELLED");
  });

  it("الصلاحية: المصمم ومدير العمليات ممنوعان", async () => {
    await expect(svc.previewOrderImport(A.designer, oA.id, { name: "x.xlsx", bytes: goodFile })).rejects.toThrow(/صلاحية/);
    await expect(svc.previewOrderImport(A.ops, oA.id, { name: "x.xlsx", bytes: goodFile })).rejects.toThrow(/صلاحية/);
    await expect(svc.previewNewOrderImport(A.ops, { name: "x.xlsx", bytes: goodFile })).rejects.toThrow(/صلاحية/);
  });

  it("لا إضافة بعد بدء الإنتاج", async () => {
    await expect(svc.previewOrderImport(A.sales, oProd.id, { name: "x.xlsx", bytes: goodFile })).rejects.toThrow("لا يمكن إضافة بنود بعد بدء الإنتاج");
    // معاينة صالحة ثم انتقل الطلب للإنتاج قبل التأكيد
    const p = await svc.previewOrderImport(A.sales, oA.id, { name: "y.xlsx", bytes: await xlsx([["بند متأخر", 1, ""]]) });
    await orders.changeStatus(A.ops, oA.id, "ON_HOLD", "اختبار");
    await expect(svc.confirmOrderImport(A.sales, p.importId!)).rejects.toThrow("لا يمكن إضافة بنود بعد بدء الإنتاج");
    expect((await db.orderItemImport.findUniqueOrThrow({ where: { id: p.importId! } })).status).toBe("PREVIEW");
    await orders.changeStatus(A.ops, oA.id, "NEW");
  });

  it("المعاينة الأقدم من 24 ساعة تنتهي", async () => {
    const p = await svc.previewOrderImport(A.sales, oA.id, { name: "z.xlsx", bytes: await xlsx([["قديم", 1, ""]]) });
    await db.orderItemImport.update({ where: { id: p.importId! }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    await expect(svc.confirmOrderImport(A.sales, p.importId!)).rejects.toThrow(/انتهت صلاحية المعاينة/);
    expect((await db.orderItemImport.findUniqueOrThrow({ where: { id: p.importId! } })).status).toBe("EXPIRED");
  });

  it("نموذج «طلب جديد»: بنود متحقق منها بلا سجل", async () => {
    const n0 = await db.orderItemImport.count();
    const p = await svc.previewNewOrderImport(A.sales, { name: "new.xlsx", bytes: goodFile });
    expect(p.canConfirm).toBe(true);
    expect(p.validRows).toHaveLength(3);
    expect(await db.orderItemImport.count()).toBe(n0);
  });

  it("لا مبالغ في نتائج الاستيراد ولا الأحداث ولا الإشعارات", async () => {
    const recs = await db.orderItemImport.findMany({ where: { orderId: oA.id } });
    const ev = await db.orderEvent.findMany({ where: { orderId: oA.id }, select: { message: true } });
    const nt = await db.notification.findMany({ where: { orderId: oA.id }, select: { title: true, body: true } });
    const text = [JSON.stringify(recs.map((r) => [r.rows, r.errors])), ...ev.map((e) => e.message), ...nt.flatMap((n) => [n.title, n.body ?? ""])].join("\n");
    for (const m of ["7300", "7,300", "٧٬٣٠٠", "ريال", "ر.س", "SAR", "price", "total"]) expect(text).not.toContain(m);
  });
});

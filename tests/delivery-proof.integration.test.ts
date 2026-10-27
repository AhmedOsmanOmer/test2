/** تكامل إثبات التسليم — يعمل فقط مع TEST_DATABASE_URL على المنفذ 5434 (بعد seed تجريبي) */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { testProofPhoto } from "../scripts/test-photo";

const url = process.env.TEST_DATABASE_URL;
const enabled = !!url && new URL(url).port === "5434";

describe.skipIf(!enabled)("تكامل: صور إثبات التسليم الإلزامية", () => {
  let db: typeof import("@/lib/db").db;
  let svc: typeof import("@/server/services/delivery");
  let A: Record<string, import("@/server/actor").Actor>;
  const storage = path.resolve(process.env.STORAGE_DIR ?? "./storage");
  const countFiles = () => {
    let n = 0;
    const walk = (d: string) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : n++; };
    walk(storage); return n;
  };

  /** طلب جاهز للتسليم لموظف المبيعات sales (للاختبار فقط: الحالة والكميات المعتمدة مباشرة في قاعدة الاختبار) */
  async function readyOrder(qty = 10) {
    const { createOrder } = await import("@/server/services/orders");
    const c = await db.customer.findFirstOrThrow();
    const o = await createOrder(A.sales, { customerId: c.id, dueDate: new Date(Date.now() + 5 * 86400_000), total: 4321, requiresDesign: false, items: [{ name: "لوحة اختبار تسليم", quantity: qty }] });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await db.orderItem.update({ where: { id: item.id }, data: { approvedQty: qty, producedQty: qty, status: "READY" } });
    await db.productionOrder.create({ data: { number: `PR-T-${randomUUID().slice(0, 8)}`, orderId: o.id, orderItemId: item.id, quantity: qty, completedQty: qty, status: "QC_PASSED" } });
    await db.order.update({ where: { id: o.id }, data: { status: "READY_FOR_DELIVERY", depositReceived: true } });
    return { id: o.id, number: o.number, itemId: item.id };
  }
  const input = (o: { id: string; itemId: string }, qty: number, key = randomUUID()) =>
    ({ orderId: o.id, method: "COURIER" as const, recipientName: "مستلم الاختبار", items: [{ orderItemId: o.itemId, quantity: qty }], idempotencyKey: key });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    svc = await import("@/server/services/delivery");
    const { loadActor } = await import("@/server/actor");
    A = {};
    for (const u of ["admin", "delivery", "sales", "sales2", "designer", "ops", "worker"]) A[u] = (await loadActor((await db.user.findUniqueOrThrow({ where: { username: u } })).id))!;
  }, 60_000);
  afterAll(async () => { await db?.$disconnect(); });

  it("التسليم مع صورة: سند + صورة إثبات + حدث + تدقيق، وانتقال الحالة", async () => {
    const o = await readyOrder();
    const files0 = countFiles();
    const dn = await svc.createDelivery(A.delivery, input(o, 10), [testProofPhoto(1), testProofPhoto(2)]);
    expect(dn.isFinal).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DELIVERED");
    const proofs = await db.attachment.findMany({ where: { deliveryId: dn.id } });
    expect(proofs).toHaveLength(2);
    expect(proofs.every((p) => p.kind === "DELIVERY_PROOF" && p.orderId === o.id && p.uploadedById === A.delivery.id && /^إثبات-تسليم-DN-/.test(p.originalName) && p.mimeType === "image/jpeg")).toBe(true);
    expect(countFiles()).toBe(files0 + 2);
    expect(await db.orderEvent.count({ where: { orderId: o.id, type: "DELIVERY_PROOF", message: "تم تسليم الطلب مع 2 صورة إثبات" } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "DELIVERY_PROOF_CREATE", entityId: dn.id } });
    expect(log.after).toMatchObject({ orderId: o.id, deliveryId: dn.id, count: 2 });
    expect([...(log.after as { attachmentIds: string[] }).attachmentIds].sort()).toEqual(proofs.map((p) => p.id).sort());
    expect((log.after as { sha256: string[] }).sha256).toEqual(expect.arrayContaining(proofs.map((p) => p.sha256)));
    const n = await db.notification.findFirstOrThrow({ where: { orderId: o.id, type: "ORDER_DELIVERED" } });
    expect(n.link).toBe(`/orders/${o.id}`);
  });

  it("بلا صورة: مرفوض والحالة لم تتغير ولا سند", async () => {
    const o = await readyOrder();
    await expect(svc.createDelivery(A.delivery, input(o, 10), [])).rejects.toThrow("أرفق صورة إثبات تسليم واحدة على الأقل");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("READY_FOR_DELIVERY");
    expect(await db.delivery.count({ where: { orderId: o.id } })).toBe(0);
  });

  it("ملف غير صالح ضمن الصور: يُرفض الكل بلا أي بيانات جزئية ولا ملفات", async () => {
    const o = await readyOrder();
    const files0 = countFiles(), att0 = await db.attachment.count();
    await expect(svc.createDelivery(A.delivery, input(o, 10), [testProofPhoto(1), { name: "x.jpg", bytes: Buffer.from("definitely not an image") }])).rejects.toThrow(/الصورة 2 ليست صورة صالحة/);
    expect(await db.delivery.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.attachment.count()).toBe(att0);
    expect(countFiles()).toBe(files0);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("READY_FOR_DELIVERY");
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).deliveredQty).toBe(0);
  });

  it("فشل داخل المعاملة (كمية أكبر من الجاهز): لا سند ولا صور ولا ملفات يتيمة", async () => {
    const o = await readyOrder(5);
    const files0 = countFiles(), att0 = await db.attachment.count();
    await expect(svc.createDelivery(A.delivery, input(o, 9), [testProofPhoto()])).rejects.toThrow(/الجاهزة للتسليم/);
    expect(await db.attachment.count()).toBe(att0);
    expect(countFiles()).toBe(files0);
  });

  it("الإرسال المكرر (متتاليًا أو متزامنًا) لا ينشئ تسليمًا ثانيًا", async () => {
    const o = await readyOrder();
    const key = randomUUID();
    const [r1, r2] = await Promise.all([svc.createDelivery(A.delivery, input(o, 4, key), [testProofPhoto()]), svc.createDelivery(A.delivery, input(o, 4, key), [testProofPhoto()])]);
    const r3 = await svc.createDelivery(A.delivery, input(o, 4, key), [testProofPhoto()]);
    expect(new Set([r1.id, r2.id, r3.id]).size).toBe(1);
    expect(await db.delivery.count({ where: { orderId: o.id } })).toBe(1);
    expect(await db.attachment.count({ where: { orderId: o.id, kind: "DELIVERY_PROOF" } })).toBe(1);
    expect((await db.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).deliveredQty).toBe(4);
  });

  it("الصلاحية والنطاق: المصمم والعامل والمبيعات لا يسلّمون؛ مدير العمليات يملك delivery.manage", async () => {
    const o = await readyOrder();
    for (const u of ["designer", "worker", "sales"]) await expect(svc.createDelivery(A[u], input(o, 1), [testProofPhoto()])).rejects.toThrow(/صلاحية/);
    expect(A.ops.permissions.has("delivery.manage")).toBe(true);
  });

  it("حذف الصورة: المدير العام فقط وبسبب، مع تدقيق وحدث", async () => {
    const o = await readyOrder();
    const dn = await svc.createDelivery(A.delivery, input(o, 10), [testProofPhoto(), testProofPhoto()]);
    const [p1] = await db.attachment.findMany({ where: { deliveryId: dn.id } });
    await expect(svc.deleteDeliveryProof(A.delivery, p1.id, "خطأ")).rejects.toThrow(/للمدير العام فقط/);
    await expect(svc.deleteDeliveryProof(A.admin, p1.id, " ")).rejects.toThrow(/سبب/);
    await svc.deleteDeliveryProof(A.admin, p1.id, "صورة لطلب آخر");
    expect(await db.attachment.count({ where: { deliveryId: dn.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "DELIVERY_PROOF_DELETE", entityId: p1.id } })).toBe(1);
    expect(await db.orderEvent.count({ where: { orderId: o.id, type: "DELIVERY_PROOF_DELETED" } })).toBe(1);
  });

  it("لا مبالغ في أحداث وإشعارات التسليم", async () => {
    const recent = await db.orderEvent.findMany({ where: { type: { in: ["DELIVERY", "DELIVERY_PROOF", "DELIVERY_PROOF_DELETED"] } }, select: { message: true } });
    const notes = await db.notification.findMany({ where: { type: "ORDER_DELIVERED" }, select: { title: true, body: true } });
    const text = [...recent.map((e) => e.message), ...notes.flatMap((x) => [x.title, x.body ?? ""])].join("\n");
    for (const m of ["4321", "4,321", "٤٬٣٢١", "ريال", "ر.س", "SAR"]) expect(text).not.toContain(m);
  });
});

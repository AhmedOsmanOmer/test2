/**
 * اختبار السيناريو التشغيلي الكامل على قاعدة بيانات حقيقية (اختبار فقط).
 * يستدعي طبقة الخدمات نفسها التي تستدعيها الواجهة، بصلاحيات كل دور:
 * إنشاء طلب ← قيمة الطلب ← تأكيد الدفعة المقدمة ← التصميم ← الإنتاج ← الجودة ← التسليم ← السداد ← الإغلاق
 * مع اختبارات سلبية للصلاحيات ونطاق الطلبات وعدم تسريب المبالغ.
 * تشغيل: npm run test:scenario  (بعد seed تجريبي على قاعدة بيانات اختبار)
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { db } from "../src/lib/db";
import { loadActor, type Actor } from "../src/server/actor";
import { createCustomer } from "../src/server/services/customers";
import { createOrder, changeStatus, setOrderMoney, setDepositReceived, addComment, cancelItemQty } from "../src/server/services/orders";
import { assignDesign, uploadDesignVersion, internalReview, recordCustomerDecision, startDesign } from "../src/server/services/design";
import { createProductionOrder, startProduction, logProgress, completeStage, completeProduction } from "../src/server/services/production";
import { inspect } from "../src/server/services/quality";
import { createDelivery } from "../src/server/services/delivery";
import { getBoardData } from "../src/server/services/liveboard";
import { testProofPhoto } from "./test-photo";
import { AppError, zodMessage } from "../src/lib/errors";
import { ZodError } from "zod";

if (process.env.NODE_ENV === "production") throw new Error("ممنوع على بيئة الإنتاج");
const as = async (u: string) => (await loadActor((await db.user.findUniqueOrThrow({ where: { username: u } })).id))!;
let n = 0;
const step = (t: string) => console.log(`  ✓ ${String(++n).padStart(2, "0")} ${t}`);
async function rejects(fn: () => Promise<unknown>, re: RegExp, label: string) {
  try { await fn(); } catch (e) {
    const msg = e instanceof ZodError ? zodMessage(e) : e instanceof AppError ? e.message : `غير متوقع: ${(e as Error).message}`;
    assert.ok(re.test(msg), `${label}: ${msg}`); console.log(`  ✓ رفض متوقع — ${label} («${msg}»)`); return;
  }
  assert.fail(`كان يجب رفض: ${label}`);
}
const order = (id: string) => db.order.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
const allChecks = { dimensions: true, colors: true, printQuality: true, materials: true, finishing: true, packaging: true, quantity: true };
const due = (days: number) => new Date(Date.now() + days * 86400_000);
/** لا مبالغ في نص السجل الزمني ولا في الإشعارات */
async function assertNoAmounts(orderId: string, amounts: string[]) {
  const [events, notes] = await Promise.all([
    db.orderEvent.findMany({ where: { orderId }, select: { message: true } }),
    db.notification.findMany({ where: { link: { contains: orderId } }, select: { title: true, body: true } }),
  ]);
  const text = [...events.map((e) => e.message), ...notes.flatMap((x) => [x.title, x.body ?? ""])].join("\n");
  for (const a of amounts) assert.ok(!text.includes(a), `تسريب مبلغ ${a} في السجل الزمني أو الإشعارات`);
}

async function main() {
  const [admin, salessup, sales, sales2, ops, designer, designer2, supervisor, worker, worker2, qc, delivery] =
    await Promise.all(["admin", "salessup", "sales", "sales2", "ops", "designer", "designer2", "supervisor", "worker", "worker2", "qc", "delivery"].map(as)) as Actor[];
  console.log("\nالسيناريو التشغيلي الكامل:\n");

  const customer = await createCustomer(sales, { name: "(اختبار) شركة عطور الندى", type: "COMPANY", phone: "0551234567", city: "الرياض", vatNumber: "300000000000003", contactName: "أ. فيصل" });
  step(`إنشاء عميل ${customer.code}`);

  // ---- إنشاء الطلب: بلا أسعار للبنود، وقيمة واحدة يدخلها شخص مخوّل ----
  const items = [
    { name: "كيس ورقي مطبوع", quantity: 2000, material: "كرافت 120 جم", printType: "أوفست", colors: "4 ألوان", finishing: "يد حبل" },
    { name: "علبة تغليف كرتون", quantity: 2000, material: "دوبلكس 350 جم", printType: "أوفست", finishing: "سلوفان مطفي" },
  ];
  await rejects(() => createOrder(sales, { customerId: customer.id, dueDate: due(-2), items }), /موعد التسليم/, "رفض موعد تسليم في الماضي (F08)");
  await rejects(() => createOrder(sales, { customerId: customer.id, dueDate: due(5), items: [{ name: "x", quantity: -3 }] }), /^المنتج 1 — الكمية يجب أن تكون أكبر من صفر$/, "رسالة عربية تذكر الحقل (F06)");
  await rejects(() => createOrder(ops, { customerId: customer.id, salesRepId: designer.id, dueDate: due(5), items }), /موظف المبيعات المسؤول/, "المصمم لا يكون موظف مبيعات مسؤولًا (F07)");
  const o0 = await createOrder(sales, { customerId: customer.id, salesRepId: sales2.id, dueDate: due(10), items });
  assert.equal(o0.salesRepId, sales.id, "موظف المبيعات يُسنَد الطلب إليه دائمًا");
  assert.equal(o0.status, "NEW"); assert.equal(Number(o0.total), 0);
  const viaOps = await createOrder(ops, { customerId: customer.id, salesRepId: "null", total: 999, dueDate: due(5), items: [{ name: "ملصق", quantity: 10 }] });
  assert.equal(viaOps.salesRepId, ops.id, "القيمة \"null\" = بدون اختيار"); assert.equal(Number(viaOps.total), 0, "مدير العمليات لا يحدد قيمة الطلب");
  step(`إنشاء الطلب ${o0.number} (NEW) بدون أسعار — المبيعات مقيد بنفسه، ومال غير المخوّل يُتجاهل`);
  const id = o0.id;

  // ---- نطاق الطلبات ----
  await rejects(() => changeStatus(sales2, id, "REVIEW"), /غير موجود/, "مبيعات آخر لا يغيّر حالة طلب ليس له");
  await rejects(() => addComment(sales2, id, "تعليق"), /غير موجود/, "مبيعات آخر لا يعلق على طلب ليس له");
  await rejects(() => setOrderMoney(sales2, id, { total: 1 }), /غير موجود/, "مبيعات آخر لا يعدّل قيمة طلب ليس له");
  await rejects(() => setOrderMoney(ops, id, { total: 1 }), /صلاحية/, "مدير العمليات لا يعدّل المبالغ");

  await changeStatus(sales, id, "REVIEW");
  await rejects(() => changeStatus(sales, id, "AWAITING_CUSTOMER_APPROVAL"), /أدخل قيمة الطلب أولاً/, "لا يتجاوز المراجعة بلا قيمة");
  await rejects(() => setOrderMoney(sales, id, { total: 100, paidAmount: 150 }), /لا يمكن أن يتجاوز/, "المدفوع لا يتجاوز القيمة");
  await setOrderMoney(sales, id, { total: 17825 });
  await changeStatus(sales, id, "AWAITING_CUSTOMER_APPROVAL");
  await changeStatus(sales, id, "AWAITING_DEPOSIT");
  step("المبيعات يدخل قيمة الطلب ويحرّكه حتى «انتظار الدفعة المطلوبة»");

  // ---- الدفعة المقدمة: تأكيد صريح فقط، بلا تجاوز (F02) ----
  await setOrderMoney(sales, id, { paidAmount: 1782.5 });
  assert.equal((await order(id)).status, "AWAITING_DEPOSIT", "تسجيل مبلغ مدفوع لا ينقل الطلب");
  await rejects(() => changeStatus(admin, id, "AWAITING_DESIGN", "عميل مهم"), /الدفعة المقدمة/, "لا تجاوز لشرط الدفعة حتى للمدير");
  await rejects(() => setDepositReceived(sales, id, true), /صلاحية/, "المبيعات لا يؤكد الدفعة");
  await rejects(() => setDepositReceived(ops, id, true), /صلاحية/, "مدير العمليات لا يؤكد الدفعة");
  await setOrderMoney(sales, id, { paidAmount: 8912.5 });
  await setDepositReceived(salessup, id, true);
  let o = await order(id);
  assert.equal(o.status, "AWAITING_DESIGN"); assert.equal(o.depositReceived, true);
  await rejects(() => setDepositReceived(salessup, id, true), /مؤكدة مسبقًا/, "لا تأكيد مكرر");
  step("مشرف المبيعات يؤكد استلام الدفعة المقدمة → انتقال آلي لانتظار التصميم");

  // ---- التصميم ----
  const [bagItem, boxItem] = o.items;
  const dt1 = await assignDesign(ops, { orderId: id, orderItemId: bagItem.id, assigneeId: designer.id, instructions: "شعار العميل على الوجهين" });
  const dt2 = await assignDesign(ops, { orderId: id, orderItemId: boxItem.id, assigneeId: designer.id });
  assert.equal((await order(id)).status, "IN_DESIGN");
  await rejects(() => uploadDesignVersion(designer2, dt1.id, [{ name: "x.pdf", bytes: Buffer.from("%PDF") }]), /مسندة لمصمم آخر/, "مصمم آخر لا يرفع على مهمة غيره");
  await rejects(() => uploadDesignVersion(designer, dt1.id, [{ name: "virus.exe", bytes: Buffer.from("MZ") }]), /غير مسموح/, "رفض نوع ملف غير مسموح");
  await startDesign(designer, dt1.id);
  await uploadDesignVersion(designer, dt1.id, [{ name: "bag-v1.pdf", bytes: Buffer.from("%PDF-1.7 bag v1") }]);
  await internalReview(ops, dt1.id, false, "تكبير الشعار 20%");
  await uploadDesignVersion(designer, dt1.id, [{ name: "bag-v2.pdf", bytes: Buffer.from("%PDF-1.7 bag v2") }]);
  await uploadDesignVersion(designer, dt2.id, [{ name: "box-v1.pdf", bytes: Buffer.from("%PDF-1.7 box v1") }]);
  await internalReview(ops, dt1.id, true); await internalReview(ops, dt2.id, true);
  assert.equal((await order(id)).status, "AWAITING_DESIGN_APPROVAL");
  await rejects(() => changeStatus(ops, id, "MATERIALS_PREP"), /اعتماد التصميم/, "منع الإنتاج قبل اعتماد العميل");
  await recordCustomerDecision(ops, dt1.id, { approved: true, approverName: "أ. فيصل" });
  await recordCustomerDecision(ops, dt2.id, { approved: true, approverName: "أ. فيصل" });
  assert.equal((await order(id)).status, "MATERIALS_PREP");
  step("التصميم: إسناد، نسختان، مراجعة داخلية، اعتماد العميل → تجهيز المواد");

  // ---- الإنتاج ----
  const offset = await db.machine.findUniqueOrThrow({ where: { code: "M-01" } });
  const folder = await db.machine.findUniqueOrThrow({ where: { code: "M-05" } });
  // فترة بعيدة حتى لا تتعارض مع أوامر تشغيل موجودة (مثل البيانات التجريبية)
  const t0 = new Date(Date.now() + 30 * 86400_000); const h = (x: number) => new Date(t0.getTime() + x * 3600_000);
  const po1 = await createProductionOrder(supervisor, { orderId: id, orderItemId: bagItem.id, quantity: 2000, machineId: offset.id, assigneeId: worker.id, plannedStart: h(0), plannedEnd: h(6), stages: ["تجهيز الملفات", "الطباعة", "القص", "التغليف"] });
  await rejects(() => createProductionOrder(supervisor, { orderId: id, orderItemId: boxItem.id, quantity: 2000, machineId: offset.id, plannedStart: h(2), plannedEnd: h(5), stages: ["الطباعة"] }), /تعارض تشغيلي/, "كشف تعارض حجز الآلة");
  const po2 = await createProductionOrder(supervisor, { orderId: id, orderItemId: boxItem.id, quantity: 2000, machineId: folder.id, assigneeId: worker2.id, plannedStart: h(0), plannedEnd: h(8), stages: ["الطباعة", "القص", "التغليف"] });
  assert.equal((await order(id)).status, "PRODUCTION_SCHEDULED");
  const boardJson = JSON.stringify(await getBoardData()).toLowerCase();
  for (const banned of ["total", "paid", "amount", "0551234567", "17825", "8912"]) assert.ok(!boardJson.includes(banned), `تسريب في الشاشة: ${banned}`);
  await rejects(() => startProduction(worker2, po1.id), /غير مسند إليك/, "موظف إنتاج لا يحدّث أمرًا غير مسند له");
  await startProduction(worker, po1.id); await startProduction(worker2, po2.id);
  assert.equal((await order(id)).status, "IN_PRODUCTION");
  const stg = await db.productionStage.findMany({ where: { productionOrderId: po1.id }, orderBy: { sequence: "asc" } });
  await completeStage(worker, stg[0].id);
  const progKey = randomUUID();
  await logProgress(worker, { productionOrderId: po1.id, goodQty: 2000, scrapQty: 35, scrapReason: "انحراف لون", idempotencyKey: progKey });
  await logProgress(worker, { productionOrderId: po1.id, goodQty: 2000, scrapQty: 35, scrapReason: "انحراف لون", idempotencyKey: progKey });
  await logProgress(worker2, { productionOrderId: po2.id, goodQty: 2000, scrapQty: 0, idempotencyKey: randomUUID() });
  assert.equal((await db.productionOrder.findUniqueOrThrow({ where: { id: po1.id } })).completedQty, 2000, "التسجيل لم يتكرر");
  await completeProduction(worker, po1.id); await completeProduction(worker2, po2.id);
  assert.equal((await order(id)).status, "QUALITY_CHECK");
  step("الإنتاج: أمرا تشغيل، الشاشة بلا مال، تسجيل الكميات مرة واحدة، إرسال للجودة");

  // ---- الجودة ----
  await rejects(() => inspect(worker, { productionOrderId: po1.id, acceptedQty: 2000, rejectedQty: 0, checks: allChecks, result: "ACCEPTED" }), /صلاحية/, "موظف الإنتاج لا يعتمد الجودة");
  await inspect(qc, { productionOrderId: po1.id, acceptedQty: 2000, rejectedQty: 0, checks: allChecks, result: "ACCEPTED" });
  await inspect(qc, { productionOrderId: po2.id, acceptedQty: 2000, rejectedQty: 0, checks: allChecks, result: "ACCEPTED_WITH_NOTES", notes: "فرق طفيف في السلوفان" });
  assert.equal((await order(id)).status, "READY_FOR_DELIVERY");
  const readyTo = await db.notification.findMany({ where: { type: "ORDER_READY_FOR_DELIVERY", link: `/orders/${id}` }, select: { user: { select: { username: true } } } });
  const readyUsers = readyTo.map((x) => x.user.username).sort();
  assert.ok(readyUsers.includes("delivery") && readyUsers.includes("sales") && !readyUsers.includes("sales2") && !readyUsers.includes("sales3"), `مستلمو «جاهز للتسليم»: ${readyUsers}`);
  step(`الجودة تعتمد → جاهز للتسليم — الإشعار لمسؤول التسليم ومندوب الطلب فقط (${readyUsers.join("، ")})`);

  // ---- التسليم ----
  await rejects(() => createDelivery(delivery, { orderId: id, method: "COURIER", recipientName: "فيصل", items: [{ orderItemId: bagItem.id, quantity: 2500 }], idempotencyKey: randomUUID() }, [testProofPhoto()]), /الجاهزة للتسليم/, "منع تسليم أكثر من الجاهز");
  const part1 = { orderId: id, method: "COURIER" as const, recipientName: "فيصل العتيبي", items: [{ orderItemId: bagItem.id, quantity: 1000 }, { orderItemId: boxItem.id, quantity: 1000 }], idempotencyKey: randomUUID() };
  await rejects(() => createDelivery(delivery, part1, []), /صورة إثبات تسليم واحدة على الأقل/, "لا تسليم بلا صورة إثبات");
  await rejects(() => createDelivery(delivery, part1, [{ name: "fake.jpg", bytes: Buffer.from("not an image at all") }]), /ليست صورة صالحة/, "رفض ملف ليس صورة بامتداد jpg");
  assert.equal((await order(id)).status, "READY_FOR_DELIVERY", "الرفض لا يغيّر الحالة");
  assert.equal(await db.delivery.count({ where: { orderId: id } }), 0);
  const dn1 = await createDelivery(delivery, part1, [testProofPhoto(1), testProofPhoto(2)]);
  const again = await createDelivery(delivery, part1, [testProofPhoto(1)]);
  assert.equal(again.id, dn1.id, "الإرسال المكرر لا ينشئ تسليمًا ثانيًا");
  assert.equal(await db.attachment.count({ where: { deliveryId: dn1.id, kind: "DELIVERY_PROOF" } }), 2);
  assert.equal(dn1.isFinal, false); assert.equal((await order(id)).status, "OUT_FOR_DELIVERY");
  await rejects(() => changeStatus(salessup, id, "CLOSED"), /لم تُسلَّم/, "منع الإغلاق قبل اكتمال التسليم");
  const dn2 = await createDelivery(delivery, { orderId: id, method: "PICKUP", recipientName: "فيصل العتيبي", items: [{ orderItemId: bagItem.id, quantity: 1000 }, { orderItemId: boxItem.id, quantity: 1000 }], idempotencyKey: randomUUID() }, [testProofPhoto(3)]);
  assert.equal(dn2.isFinal, true); assert.equal((await order(id)).status, "DELIVERED");
  assert.equal(await db.orderEvent.count({ where: { orderId: id, type: "DELIVERY_PROOF", message: "تم تسليم الطلب مع 1 صورة إثبات" } }), 1);
  step(`تسليم جزئي ${dn1.number} (صورتا إثبات) ثم نهائي ${dn2.number} (صورة) — لا تسليم بلا صورة، والإرسال المكرر لا يتكرر`);

  // ---- السداد والإغلاق ----
  await rejects(() => changeStatus(salessup, id, "CLOSED"), /^الطلب غير مسدد بالكامل$/, "منع الإغلاق قبل السداد (بلا أرقام)");
  await rejects(() => changeStatus(sales, id, "CLOSED"), /صلاحية/, "المبيعات لا يغلق الطلبات");
  await setOrderMoney(sales, id, { paidAmount: 17825 });
  await changeStatus(salessup, id, "CLOSED");
  o = await order(id);
  assert.equal(o.status, "CLOSED"); assert.equal(Number(o.paidAmount), 17825);
  await rejects(() => setOrderMoney(sales, id, { total: 1 }), /مغلق أو ملغى/, "لا تعديل لمبالغ طلب مغلق");
  step("السداد الكامل ثم إغلاق الطلب بواسطة مشرف المبيعات");

  await assertNoAmounts(id, ["17825", "17,825", "١٧٬٨٢٥", "8912", "8,912", "٨٬٩١٢", "1782", "ريال", "ر.س", "SAR"]);
  // سجل التدقيق (وفيه المبالغ) لا يراه إلا المدير العام
  const auditViewers = await db.user.findMany({ where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { key: "audit.view" } } } } } } }, select: { username: true } });
  assert.deepEqual(auditViewers.map((u) => u.username), ["admin"]);
  step("لا مبالغ ولا كلمات عملة في السجل الزمني ولا في الإشعارات، وسجل التدقيق للمدير العام فقط");

  // ---- الإلغاء الجزئي ينبّه لمراجعة القيمة ----
  const small = await createOrder(sales, { customerId: customer.id, dueDate: due(3), total: 500, items: [{ name: "بطاقات عمل", quantity: 1000 }] });
  const smallItem = await db.orderItem.findFirstOrThrow({ where: { orderId: small.id } });
  await cancelItemQty(ops, smallItem.id, 200, "طلب العميل");
  const cancelNotes = await db.notification.findMany({ where: { type: "ITEM_PARTIAL_CANCEL", link: `/orders/${small.id}` }, select: { title: true, user: { select: { username: true } } } });
  assert.ok(cancelNotes.every((x) => x.title === "تم إلغاء كمية جزئيًا — راجع قيمة الطلب"));
  assert.deepEqual(cancelNotes.map((x) => x.user.username).sort(), ["sales", "salessup"]);
  step("الإلغاء الجزئي ينبّه المندوب ومشرف المبيعات لمراجعة القيمة");

  const full = await db.order.findUniqueOrThrow({ where: { id }, include: { events: true, statusHistory: true, deliveries: true } });
  const audits = await db.auditLog.count({ where: { entityId: id } });
  console.log(`\nالنتيجة النهائية للطلب ${full.number}: أحداث ${full.events.length} | تغييرات حالة ${full.statusHistory.length} | سندات تسليم ${full.deliveries.length} | سجلات تدقيق ${audits}`);
  assert.ok(full.events.length >= 25); assert.ok(audits >= 15);
  console.log("\n  ✅ السيناريو التشغيلي الكامل نجح\n");
}
main().then(() => db.$disconnect()).catch(async (e) => { console.error("\n  ❌ فشل:", e.message); await db.$disconnect(); process.exit(1); });

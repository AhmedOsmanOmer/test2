import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { notFound, rule, AppError } from "@/lib/errors";
import { checkTransition, EXCEPTION, type FlowContext } from "@/lib/order-flow";
import { ORDER_STATUS } from "@/lib/labels";
import { round2, riyadhYmd } from "@/lib/format";
import { SALES_REP_ROLES } from "@/lib/permissions";
import { itemSchema, optText } from "@/lib/order-item";
import type { OrderStatus } from "@/generated/prisma/enums";
import { can, requirePerm, type Actor } from "../actor";
import { audit, notify, notifyOrderEvent, timeline, nextNumber } from "./audit";
import { EVENT_RULES, statusChangeRule, statusChangeText, cutText } from "@/lib/notification-rules";
import { date as fmtDate } from "@/lib/format";
import { assertOrderAccess } from "./access";

const MAX_MONEY = 100_000_000;
const money = z.coerce.number({ invalid_type_error: "مبلغ غير صالح" }).nonnegative("لا يمكن أن يكون المبلغ سالبًا").max(MAX_MONEY, "المبلغ أكبر من المسموح");
export { itemSchema };

/** القيمة الفارغة أو "null" (قائمة مندوبين فارغة في الواجهة) = غير محدد */
const optionalId = z.preprocess((v) => (v === "" || v === "null" || v === "undefined" || v === null ? undefined : v), z.string().optional());

export const orderSchema = z.object({
  customerId: z.string({ required_error: "اختر العميل" }).min(1, "اختر العميل"),
  salesRepId: optionalId,
  orderType: optText(100),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"], { errorMap: () => ({ message: "اختر الأولوية" }) }).default("NORMAL"),
  dueDate: z.coerce.date({ errorMap: () => ({ message: "أدخل موعد التسليم" }) })
    .refine((d) => riyadhYmd(d) >= riyadhYmd(), "موعد التسليم لا يمكن أن يكون في الماضي"),
  requiresDesign: z.boolean().default(true),
  requiresQC: z.boolean().default(true),
  total: money.optional(),
  notes: optText(4000),
  items: z.array(itemSchema, { required_error: "أضف منتجًا واحدًا على الأقل" }).min(1, "أضف منتجًا واحدًا على الأقل").max(50, "عدد المنتجات أكبر من المسموح (50)"),
});
export type OrderInput = z.input<typeof orderSchema>;

/** موظف المبيعات المسؤول: من لا يرى كل الطلبات يُسنَد الطلب إليه دائمًا؛ غيره يختار مستخدمًا نشطًا بدور مبيعات/إدارة */
async function resolveSalesRep(tx: Tx, actor: Actor, requested?: string) {
  const id = !can(actor, "orders.view_all") ? actor.id : requested ?? actor.id;
  const rep = await tx.user.findFirst({ where: { id, isActive: true, roles: { some: { role: { key: { in: SALES_REP_ROLES } } } } }, select: { id: true } });
  if (!rep) throw rule("موظف المبيعات المسؤول يجب أن يكون مستخدمًا نشطًا بدور مبيعات أو مشرف مبيعات أو إدارة");
  return rep.id;
}

/** ينشئ طلبًا داخل معاملة. المال لا يُقبل إلا ممن يملك orders.edit_value (ويُتجاهل من غيره) */
export async function createOrderTx(tx: Tx, actor: Actor, input: OrderInput) {
  const d = orderSchema.parse(input);
  const customer = await tx.customer.findUnique({ where: { id: d.customerId }, select: { id: true, isActive: true } });
  if (!customer || !customer.isActive) throw rule("العميل غير موجود");
  const salesRepId = await resolveSalesRep(tx, actor, d.salesRepId);
  const total = can(actor, "orders.edit_value") && d.total !== undefined ? round2(d.total) : 0;
  const number = await nextNumber(tx, "GP");
  const status: OrderStatus = "NEW";

  const order = await tx.order.create({
    data: {
      number, customerId: d.customerId, salesRepId, createdById: actor.id, branchId: actor.branchId,
      orderType: d.orderType, priority: d.priority, dueDate: d.dueDate, requiresDesign: d.requiresDesign, requiresQC: d.requiresQC,
      notes: d.notes, total, status,
      items: { create: d.items.map(({ categoryId, ...l }, k) => ({ ...l, categoryId: categoryId || undefined, sortOrder: k })) },
      statusHistory: { create: { toStatus: status, changedById: actor.id, reason: "إنشاء الطلب" } },
    },
  });
  await timeline(tx, order.id, actor, "ORDER_CREATED", `تم إنشاء الطلب ${number} بواسطة ${actor.fullName}`);
  await audit(tx, actor.id, "ORDER_CREATE", "Order", order.id, null, { number, total, salesRepId });
  // المندوب يُشعَر إن أنشأ الطلبَ غيرُه (المنفّذ مستثنى دائمًا)
  await notifyOrderEvent(tx, actor, order, EVENT_RULES.ORDER_NEW, { type: "ORDER_NEW", title: `طلب جديد ${number}` });
  return order;
}

export async function createOrder(actor: Actor, input: OrderInput) {
  requirePerm(actor, "orders.create");
  return db.$transaction((tx) => createOrderTx(tx, actor, input));
}

export async function flowContext(tx: Tx, orderId: string) {
  const o = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      designTasks: { select: { status: true } },
      productionOrders: { where: { parentId: null }, select: { status: true, reworks: { select: { status: true } } } },
      items: { select: { quantity: true, deliveredQty: true, cancelledQty: true } },
    },
  });
  if (!o) throw notFound("الطلب غير موجود");
  // أمر التشغيل الأصلي المرفوض يُعتبر مُجتازًا إذا اجتازت جميع أوامر إعادة إنتاجه
  const pos = o.productionOrders.map((p) =>
    p.status === "QC_FAILED" && p.reworks.length && p.reworks.every((r) => r.status === "QC_PASSED") ? { status: "QC_PASSED" } : { status: p.status },
  );
  // آخر حالة من المسار الرئيسي — مرجع المقارنة عند الخروج من حالة استثنائية
  const lastMain = EXCEPTION.includes(o.status)
    ? await tx.orderStatusHistory.findFirst({ where: { orderId, toStatus: { notIn: EXCEPTION } }, orderBy: { createdAt: "desc" }, select: { toStatus: true } })
    : null;
  const ctx: FlowContext = {
    status: o.status, statusBeforeHold: o.statusBeforeHold, lastMainStatus: lastMain?.toStatus ?? null,
    requiresDesign: o.requiresDesign, requiresQC: o.requiresQC,
    total: Number(o.total), paidAmount: Number(o.paidAmount), depositReceived: o.depositReceived,
    designTasks: o.designTasks, productionOrders: pos, items: o.items,
  };
  return { order: o, ctx };
}

/**
 * تغيير حالة الطلب — المدخل الوحيد لتغيير الحالة (يدويًا أو آليًا).
 * يستخدم قفلًا تفاؤليًا (version) لمنع تعارض موظفَين يغيران الحالة معًا.
 */
export async function transitionTx(tx: Tx, actor: Actor, orderId: string, to: OrderStatus, opts: { reason?: string; system?: boolean; expectedVersion?: number } = {}) {
  const { order, ctx } = await flowContext(tx, orderId);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== order.version)
    throw new AppError("تم تعديل الطلب من مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.", "CONFLICT");
  const check = checkTransition(ctx, to, {
    reason: opts.reason, canCancel: can(actor, "orders.cancel"), canClose: can(actor, "orders.close") || !!opts.system,
  });
  if (!check.ok) throw rule(check.error);

  const now = new Date();
  const updated = await tx.order.updateMany({
    where: { id: orderId, version: order.version },
    data: {
      status: to, version: { increment: 1 },
      statusBeforeHold: to === "ON_HOLD" ? order.status : order.statusBeforeHold,
      delayReason: to === "ON_HOLD" ? opts.reason : undefined,
      completedAt: to === "DELIVERED" ? now : undefined,
      closedAt: to === "CLOSED" ? now : undefined,
      cancelledAt: to === "CANCELLED" ? now : undefined,
    },
  });
  if (updated.count === 0) throw new AppError("تم تعديل الطلب من مستخدم آخر. أعد المحاولة.", "CONFLICT");
  if (to === "CANCELLED") await tx.orderItem.updateMany({ where: { orderId }, data: { status: "CANCELLED" } });

  await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: to, reason: opts.reason, changedById: actor.id } });
  await timeline(tx, orderId, actor, "STATUS_CHANGED", `تغيرت الحالة من «${ORDER_STATUS[order.status]}» إلى «${ORDER_STATUS[to]}»`, { from: order.status, to, reason: opts.reason });
  await audit(tx, actor.id, "ORDER_STATUS", "Order", orderId, { status: order.status }, { status: to, reason: opts.reason });

  const events: Partial<Record<OrderStatus, { roles: string[]; title: string }>> = {
    AWAITING_DESIGN: { roles: ["OPERATIONS_MANAGER"], title: "طلب تصميم جديد" },
    // جاهز للتسليم: مسؤول التسليم + موظف المبيعات المسؤول عن الطلب فقط (F27)
    READY_FOR_DELIVERY: { roles: ["DELIVERY"], title: "طلب جاهز للتسليم" },
    CLOSED: { roles: ["SUPER_ADMIN"], title: "اكتمال وإغلاق طلب" },
  };
  const ev = events[to];
  // الإشعار الأخص أولًا، ثم إشعار تغيير الحالة العام لمن لم يصله إشعار عن هذا الطلب في نفس المعاملة
  if (ev) await notify(tx, { roles: ev.roles, userIds: [order.salesRepId], type: `ORDER_${to}`, title: `${ev.title}: ${order.number}`, link: `/orders/${orderId}`, orderId, actorId: actor.id });
  const statusRule = statusChangeRule(to);
  const text = statusChangeText(order.number, ORDER_STATUS[order.status], ORDER_STATUS[to], opts.reason === "انتقال آلي" ? undefined : opts.reason);
  await notifyOrderEvent(tx, actor, order, statusRule, { type: "ORDER_STATUS_CHANGED", title: text.title, body: text.body, generic: true });
  return to;
}

export async function changeStatus(actor: Actor, orderId: string, to: OrderStatus, reason?: string, expectedVersion?: number) {
  // الإغلاق إجراء إداري له صلاحية مستقلة
  if (to === "CLOSED") requirePerm(actor, "orders.close");
  else if (to === "CANCELLED") requirePerm(actor, "orders.cancel");
  else requirePerm(actor, "orders.change_status");
  await assertOrderAccess(actor, orderId);
  return db.$transaction((tx) => transitionTx(tx, actor, orderId, to, { reason, expectedVersion }));
}

/** انتقال آلي عند حدث (تأكيد الدفعة، اعتماد تصميم...) — يتجاهل الانتقال إن لم يكن مسموحًا بعد. لا تجاوز لأي شرط. */
export async function tryAdvance(tx: Tx, actor: Actor, orderId: string, to: OrderStatus, onlyFrom: OrderStatus[]) {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!o || !onlyFrom.includes(o.status)) return false;
  try {
    await transitionTx(tx, actor, orderId, to, { system: true, reason: "انتقال آلي" });
    return true;
  } catch (e) {
    if (e instanceof AppError && e.code === "RULE") return false;
    throw e;
  }
}

/** قيمة الطلب والمبلغ المدفوع — يدخلها شخص مخوّل. لا أرقام في السجل الزمني (التفاصيل في سجل التدقيق) */
export const orderMoneySchema = z.object({
  total: money.optional(),
  paidAmount: money.optional(),
  expectedVersion: z.number().int().optional(),
});

export async function setOrderMoney(actor: Actor, orderId: string, input: z.input<typeof orderMoneySchema>) {
  requirePerm(actor, "orders.edit_value");
  const d = orderMoneySchema.parse(input);
  if (d.total === undefined && d.paidAmount === undefined) throw rule("أدخل قيمة الطلب أو المبلغ المدفوع");
  await assertOrderAccess(actor, orderId);
  return db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (d.expectedVersion !== undefined && d.expectedVersion !== o.version)
      throw new AppError("تم تعديل الطلب من مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.", "CONFLICT");
    if (["CLOSED", "CANCELLED"].includes(o.status)) throw rule("لا يمكن تعديل مبالغ طلب مغلق أو ملغى");
    const before = { total: Number(o.total), paidAmount: Number(o.paidAmount) };
    const after = { total: round2(d.total ?? before.total), paidAmount: round2(d.paidAmount ?? before.paidAmount) };
    if (after.paidAmount > after.total) throw rule("المبلغ المدفوع لا يمكن أن يتجاوز قيمة الطلب");
    if (after.total === before.total && after.paidAmount === before.paidAmount) throw rule("لم يتغير شيء");
    const updated = await tx.order.updateMany({ where: { id: orderId, version: o.version }, data: { ...after, version: { increment: 1 } } });
    if (updated.count === 0) throw new AppError("تم تعديل الطلب من مستخدم آخر. أعد المحاولة.", "CONFLICT");
    const what = after.total !== before.total && after.paidAmount !== before.paidAmount ? "تم تحديث قيمة الطلب والمبلغ المدفوع"
      : after.total !== before.total ? "تم تحديث قيمة الطلب" : "تم تحديث المبلغ المدفوع";
    await timeline(tx, orderId, actor, "ORDER_VALUE_UPDATED", what);
    await audit(tx, actor.id, "ORDER_MONEY", "Order", orderId, before, after);
    return after;
  });
}

/** تأكيد (أو إلغاء تأكيد) استلام الدفعة المقدمة. التأكيد ينقل الطلب آليًا من «انتظار الدفعة» بلا أي تجاوز (F02) */
export async function setDepositReceived(actor: Actor, orderId: string, value: boolean, reason?: string) {
  requirePerm(actor, "orders.set_deposit");
  await assertOrderAccess(actor, orderId);
  if (!value && !reason?.trim()) throw rule("اذكر سبب إلغاء تأكيد الدفعة");
  return db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (["CLOSED", "CANCELLED"].includes(o.status)) throw rule("لا يمكن تعديل طلب مغلق أو ملغى");
    if (o.depositReceived === value) throw rule(value ? "الدفعة المقدمة مؤكدة مسبقًا" : "الدفعة المقدمة غير مؤكدة أصلًا");
    const updated = await tx.order.updateMany({ where: { id: orderId, version: o.version }, data: { depositReceived: value, version: { increment: 1 } } });
    if (updated.count === 0) throw new AppError("تم تعديل الطلب من مستخدم آخر. أعد المحاولة.", "CONFLICT");
    await timeline(tx, orderId, actor, value ? "DEPOSIT_RECEIVED" : "DEPOSIT_UNSET",
      value ? "تم تأكيد استلام الدفعة المقدمة" : "تم إلغاء تأكيد استلام الدفعة المقدمة", reason?.trim() ? { reason: reason.trim() } : undefined);
    await audit(tx, actor.id, value ? "DEPOSIT_RECEIVED" : "DEPOSIT_UNSET", "Order", orderId, { depositReceived: o.depositReceived }, { depositReceived: value, reason });
    if (value) {
      await notifyOrderEvent(tx, actor, o, EVENT_RULES.DEPOSIT_RECEIVED, { type: "DEPOSIT_RECEIVED", title: `تم تأكيد استلام الدفعة المقدمة للطلب ${o.number}` });
      await tryAdvance(tx, actor, orderId, o.requiresDesign ? "AWAITING_DESIGN" : "MATERIALS_PREP", ["AWAITING_DEPOSIT"]);
    }
    return value;
  });
}

export async function cancelItemQty(actor: Actor, orderItemId: string, qty: number, reason: string) {
  requirePerm(actor, "orders.cancel");
  if (!reason.trim()) throw rule("سبب الإلغاء الجزئي مطلوب");
  const item = await db.orderItem.findUnique({ where: { id: orderItemId }, select: { orderId: true } });
  if (!item) throw notFound();
  await assertOrderAccess(actor, item.orderId);
  return db.$transaction(async (tx) => {
    const it = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: { order: { select: { id: true, number: true, salesRepId: true } } } });
    const open = it.quantity - it.deliveredQty - it.cancelledQty;
    if (!Number.isInteger(qty) || qty <= 0 || qty > open) throw rule(`الكمية القابلة للإلغاء ${open}`);
    await tx.orderItem.update({ where: { id: it.id }, data: { cancelledQty: { increment: qty }, status: qty === open && it.deliveredQty === 0 ? "CANCELLED" : undefined } });
    await timeline(tx, it.orderId, actor, "ITEM_PARTIAL_CANCEL", `إلغاء ${qty} من «${it.name}»`, { reason });
    await audit(tx, actor.id, "ITEM_CANCEL", "OrderItem", it.id, null, { qty, reason });
    // قيمة الطلب يدوية الآن، فننبّه من يراجعها
    await notify(tx, { roles: ["SALES_SUPERVISOR"], userIds: [it.order.salesRepId], type: "ITEM_PARTIAL_CANCEL",
      title: "تم إلغاء كمية جزئيًا — راجع قيمة الطلب", body: `الطلب ${it.order.number}`, link: `/orders/${it.order.id}`, orderId: it.order.id, actorId: actor.id });
  });
}

export async function addComment(actor: Actor, orderId: string, body: string) {
  requirePerm(actor, "orders.view");
  const text = body.trim().slice(0, 4000);
  if (!text) throw rule("التعليق فارغ");
  await assertOrderAccess(actor, orderId);
  return db.$transaction(async (tx) => {
    await tx.orderComment.create({ data: { orderId, body: text, authorId: actor.id } });
    await timeline(tx, orderId, actor, "COMMENT", `تعليق من ${actor.fullName}`);
    // نص التعليق لا يُنسخ للإشعار (قد يحتوي مبالغ يكتبها المستخدم)
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, number: true, salesRepId: true } });
    await notifyOrderEvent(tx, actor, o, EVENT_RULES.ORDER_COMMENT, { type: "ORDER_COMMENT", title: `تعليق جديد من ${actor.fullName} على الطلب ${o.number}` });
  });
}

const conflict = () => new AppError("تم تعديل الطلب من مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.", "CONFLICT");

/** تغيير موعد التسليم — بسبب إلزامي، وبنفس قاعدة التاريخ عند الإنشاء (اليوم أو بعده بتوقيت الرياض) */
export async function changeDueDate(actor: Actor, orderId: string, newDate: Date, reason: string, expectedVersion?: number) {
  requirePerm(actor, "orders.edit");
  if (!reason?.trim()) throw rule("اذكر سبب تغيير موعد التسليم");
  if (!(newDate instanceof Date) || isNaN(newDate.getTime())) throw rule("موعد التسليم: تاريخ غير صالح");
  if (riyadhYmd(newDate) < riyadhYmd()) throw rule("موعد التسليم لا يمكن أن يكون في الماضي");
  await assertOrderAccess(actor, orderId);
  return db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (expectedVersion !== undefined && expectedVersion !== o.version) throw conflict();
    if (["CLOSED", "CANCELLED"].includes(o.status)) throw rule("لا يمكن تعديل طلب مغلق أو ملغى");
    if (riyadhYmd(o.dueDate) === riyadhYmd(newDate)) throw rule("الموعد الجديد مطابق للموعد الحالي");
    const updated = await tx.order.updateMany({ where: { id: orderId, version: o.version }, data: { dueDate: newDate, version: { increment: 1 } } });
    if (updated.count === 0) throw conflict();
    const r = reason.trim().slice(0, 500);
    await timeline(tx, orderId, actor, "DUE_DATE_CHANGED", `تم تغيير موعد التسليم من ${fmtDate(o.dueDate)} إلى ${fmtDate(newDate)}`, { reason: r });
    await audit(tx, actor.id, "ORDER_DUE_CHANGE", "Order", orderId, { dueDate: o.dueDate }, { dueDate: newDate, reason: r });
    await notifyOrderEvent(tx, actor, o, EVENT_RULES.ORDER_DUE_CHANGED, {
      type: "ORDER_DUE_CHANGED", title: `تغيير موعد تسليم الطلب ${o.number} إلى ${fmtDate(newDate)}`, body: cutText(r),
    });
    return newDate;
  });
}

/** نقل الطلب لموظف مبيعات آخر (orders.reassign) — المندوب الجديد مستخدم نشط بدور مبيعات أو مشرف مبيعات */
export async function reassignSalesRep(actor: Actor, orderId: string, newRepId: string, reason: string, expectedVersion?: number) {
  requirePerm(actor, "orders.reassign");
  if (!reason?.trim()) throw rule("اذكر سبب تغيير موظف المبيعات");
  await assertOrderAccess(actor, orderId);
  return db.$transaction(async (tx) => {
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { salesRep: { select: { fullName: true } } } });
    if (expectedVersion !== undefined && expectedVersion !== o.version) throw conflict();
    if (["CLOSED", "CANCELLED"].includes(o.status)) throw rule("لا يمكن تعديل طلب مغلق أو ملغى");
    if (o.salesRepId === newRepId) throw rule("الموظف المختار هو المسؤول الحالي");
    const rep = await tx.user.findFirst({ where: { id: newRepId, isActive: true, roles: { some: { role: { key: { in: ["SALES", "SALES_SUPERVISOR"] } } } } }, select: { id: true, fullName: true } });
    if (!rep) throw rule("موظف المبيعات الجديد يجب أن يكون مستخدمًا نشطًا بدور مبيعات أو مشرف مبيعات");
    const r = reason.trim().slice(0, 500);
    const title = `تغيير موظف المبيعات المسؤول عن الطلب ${o.number}`;
    const body = cutText(`${o.salesRep.fullName} ← ${rep.fullName}: ${r}`);
    // قبل النقل: المندوب السابق (ما زال ضمن نطاقه) ومدير العمليات
    await notifyOrderEvent(tx, actor, o, EVENT_RULES.ORDER_REP_CHANGED, { type: "ORDER_REP_CHANGED", title, body });
    const updated = await tx.order.updateMany({ where: { id: orderId, version: o.version }, data: { salesRepId: rep.id, version: { increment: 1 } } });
    if (updated.count === 0) throw conflict();
    await timeline(tx, orderId, actor, "SALES_REP_CHANGED", `تم تغيير موظف المبيعات المسؤول من ${o.salesRep.fullName} إلى ${rep.fullName}`, { reason: r });
    await audit(tx, actor.id, "ORDER_REP_CHANGE", "Order", orderId, { salesRepId: o.salesRepId }, { salesRepId: rep.id, reason: r });
    // بعد النقل: المندوب الجديد
    await notify(tx, { userIds: [rep.id], type: "ORDER_REP_CHANGED", title, body, link: `/orders/${orderId}`, orderId, actorId: actor.id });
    return rep.id;
  });
}

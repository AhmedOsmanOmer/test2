/**
 * آلة حالات الطلب — منطق نقي بدون قاعدة بيانات لسهولة الاختبار.
 * "متأخر" ليست حالة مخزنة بل مؤشر مشتق (dueDate < الآن والطلب غير منتهٍ)
 * حتى لا يضيع موقع الطلب الحقيقي في المسار عند تأخره.
 */
import type { OrderStatus } from "@/generated/prisma/enums";

export const MAIN_FLOW: OrderStatus[] = [
  "NEW", "REVIEW", "AWAITING_CUSTOMER_APPROVAL", "AWAITING_DEPOSIT",
  "AWAITING_DESIGN", "IN_DESIGN", "DESIGN_REVIEW", "AWAITING_DESIGN_APPROVAL",
  "MATERIALS_PREP", "PRODUCTION_SCHEDULED", "IN_PRODUCTION", "FINISHING_PACKAGING", "QUALITY_CHECK",
  "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "CLOSED",
];
export const EXCEPTION: OrderStatus[] = ["ON_HOLD", "NEEDS_REVISION", "REWORK", "CANCELLED", "RETURNED"];
const DESIGN_STEPS: OrderStatus[] = ["AWAITING_DESIGN", "IN_DESIGN", "DESIGN_REVIEW", "AWAITING_DESIGN_APPROVAL"];
export const TERMINAL: OrderStatus[] = ["CLOSED", "CANCELLED"];
export const FINISHED: OrderStatus[] = ["DELIVERED", "CLOSED", "CANCELLED", "RETURNED"];

export const idx = (s: OrderStatus) => MAIN_FLOW.indexOf(s);

export interface FlowContext {
  status: OrderStatus;
  statusBeforeHold: OrderStatus | null;
  /** آخر حالة من المسار الرئيسي قبل الدخول في حالة استثنائية (من سجل الحالات) */
  lastMainStatus: OrderStatus | null;
  requiresDesign: boolean;
  requiresQC: boolean;
  total: number;
  paidAmount: number;
  depositReceived: boolean;
  designTasks: { status: string }[];
  productionOrders: { status: string }[];
  items: { quantity: number; deliveredQty: number; cancelledQty: number }[];
}

export interface TransitionOpts {
  reason?: string;
  canCancel?: boolean;
  canClose?: boolean;
}

export type Check = { ok: true } | { ok: false; error: string };

export function designSatisfied(c: FlowContext) {
  if (!c.requiresDesign) return true;
  const active = c.designTasks.filter((t) => t.status !== "CANCELLED");
  return active.length > 0 && active.every((t) => t.status === "APPROVED");
}
export function qcSatisfied(c: FlowContext) {
  const active = c.productionOrders.filter((p) => p.status !== "CANCELLED");
  if (active.length === 0) return false;
  return c.requiresQC ? active.every((p) => p.status === "QC_PASSED") : active.every((p) => ["COMPLETED", "QC_PASSED"].includes(p.status));
}
export function fullyDelivered(c: FlowContext) {
  return c.items.every((i) => i.deliveredQty + i.cancelledQty >= i.quantity);
}
export const fullyPaid = (c: Pick<FlowContext, "total" | "paidAmount">) => c.paidAmount + 0.005 >= c.total;

/** موقع الطلب في المسار الرئيسي؛ للحالات الاستثنائية: الحالة التي كان عليها قبلها */
function basePosition(c: FlowContext) {
  if (!EXCEPTION.includes(c.status)) return idx(c.status);
  if (c.status === "RETURNED") return idx("DELIVERED");
  // statusBeforeHold يُحدَّث فقط عند الإيقاف، فقد يكون قديمًا لباقي الحالات الاستثنائية
  const candidates = c.status === "ON_HOLD" ? [c.statusBeforeHold, c.lastMainStatus] : [c.lastMainStatus, c.statusBeforeHold];
  const base = candidates.find((s): s is OrderStatus => !!s && !EXCEPTION.includes(s));
  return base ? idx(base) : -1;
}

/** هل يُسمح بالانتقال؟ يعيد سبب الرفض بالعربية */
export function checkTransition(c: FlowContext, to: OrderStatus, o: TransitionOpts = {}): Check {
  const from = c.status;
  if (from === to) return { ok: false, error: "الطلب في هذه الحالة بالفعل" };
  if (from === "CANCELLED") return { ok: false, error: "لا يمكن تغيير حالة طلب ملغى" };
  if (from === "CLOSED" && to !== "RETURNED") return { ok: false, error: "الطلب مغلق؛ المسموح فقط تسجيل مرتجع" };

  // ---- الحالات الاستثنائية ----
  if (to === "CANCELLED") {
    if (!o.canCancel) return { ok: false, error: "إلغاء الطلب يتطلب صلاحية الإلغاء" };
    if (!o.reason?.trim()) return { ok: false, error: "يجب ذكر سبب الإلغاء" };
    return { ok: true };
  }
  if (to === "ON_HOLD") {
    if (!o.reason?.trim()) return { ok: false, error: "يجب ذكر سبب الإيقاف" };
    return { ok: true };
  }
  if (to === "RETURNED") {
    if (!["DELIVERED", "CLOSED", "OUT_FOR_DELIVERY"].includes(from)) return { ok: false, error: "المرتجع يكون بعد التسليم فقط" };
    if (!o.reason?.trim()) return { ok: false, error: "يجب ذكر سبب الإرجاع" };
    return { ok: true };
  }
  if (to === "NEEDS_REVISION" || to === "REWORK") {
    if (!o.reason?.trim()) return { ok: false, error: "يجب ذكر السبب" };
    return { ok: true };
  }
  if (from === "ON_HOLD" && c.statusBeforeHold && to !== c.statusBeforeHold && idx(to) > idx(c.statusBeforeHold))
    return { ok: false, error: "استئناف الطلب المعلق يكون إلى حالته السابقة أو مرحلة قبلها" };

  // ---- المسار الرئيسي ----
  const ti = idx(to);
  const fi = basePosition(c);
  if (ti < 0) return { ok: false, error: "حالة غير معروفة" };

  if (fi >= 0 && ti < fi) {
    // إرجاع لمرحلة سابقة (ومنها الخروج من حالة استثنائية إلى ما قبل موقع الطلب)
    if (!o.reason?.trim()) return { ok: false, error: "إرجاع الطلب لمرحلة سابقة يتطلب ذكر السبب" };
    return { ok: true };
  }

  if (!c.requiresDesign && DESIGN_STEPS.includes(to)) return { ok: false, error: "هذا الطلب لا يتطلب تصميمًا" };
  if (ti > idx("REVIEW") && !(c.total > 0)) return { ok: false, error: "أدخل قيمة الطلب أولاً" };
  if (ti > idx("AWAITING_DEPOSIT") && !c.depositReceived) return { ok: false, error: "لم يتم تأكيد استلام الدفعة المقدمة بعد" };
  if (ti >= idx("MATERIALS_PREP") && !designSatisfied(c))
    return { ok: false, error: "لا يمكن الانتقال للإنتاج قبل اعتماد التصميم من العميل" };
  if (ti >= idx("READY_FOR_DELIVERY") && !qcSatisfied(c))
    return { ok: false, error: c.requiresQC ? "يجب اجتياز فحص الجودة لجميع أوامر التشغيل" : "يجب إنهاء جميع أوامر التشغيل" };
  if (ti >= idx("DELIVERED") && !fullyDelivered(c)) return { ok: false, error: "لم تُسلَّم جميع الكميات بعد" };
  if (to === "CLOSED") {
    if (!o.canClose) return { ok: false, error: "إغلاق الطلب يتطلب صلاحية" };
    if (!fullyPaid(c)) return { ok: false, error: "الطلب غير مسدد بالكامل" };
  }
  return { ok: true };
}

/** نسبة الإنجاز التقريبية حسب موقع الطلب في المسار */
export function progressOf(s: OrderStatus) {
  const i = idx(s);
  if (i < 0) return 0;
  return Math.round((i / (MAIN_FLOW.length - 1)) * 100);
}

export function isLate(dueDate: Date, status: OrderStatus, now = new Date()) {
  return dueDate.getTime() < now.getTime() && !FINISHED.includes(status);
}

/** أعمدة لوحة كانبان */
export const KANBAN_COLUMNS: { key: string; title: string; statuses: OrderStatus[] }[] = [
  { key: "intake", title: "جديد ومراجعة", statuses: ["NEW", "REVIEW", "AWAITING_CUSTOMER_APPROVAL"] },
  { key: "deposit", title: "بانتظار الدفعة", statuses: ["AWAITING_DEPOSIT"] },
  { key: "design", title: "التصميم", statuses: ["AWAITING_DESIGN", "IN_DESIGN", "DESIGN_REVIEW"] },
  { key: "approval", title: "اعتماد العميل", statuses: ["AWAITING_DESIGN_APPROVAL"] },
  { key: "prep", title: "تجهيز وجدولة", statuses: ["MATERIALS_PREP", "PRODUCTION_SCHEDULED"] },
  { key: "production", title: "الإنتاج", statuses: ["IN_PRODUCTION", "FINISHING_PACKAGING", "REWORK"] },
  { key: "qc", title: "الجودة", statuses: ["QUALITY_CHECK"] },
  { key: "delivery", title: "التسليم", statuses: ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"] },
  { key: "hold", title: "معلق / تعديل", statuses: ["ON_HOLD", "NEEDS_REVISION"] },
];

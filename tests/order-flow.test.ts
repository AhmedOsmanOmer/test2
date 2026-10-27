import { describe, it, expect } from "vitest";
import { checkTransition, isLate, MAIN_FLOW, KANBAN_COLUMNS, type FlowContext } from "@/lib/order-flow";

const base = (o: Partial<FlowContext> = {}): FlowContext => ({
  status: "AWAITING_DEPOSIT", statusBeforeHold: null, lastMainStatus: null, requiresDesign: true, requiresQC: true, total: 1000, paidAmount: 0,
  depositReceived: false, designTasks: [], productionOrders: [], items: [{ quantity: 10, deliveredQty: 0, cancelledQty: 0 }], ...o,
});
const err = (r: ReturnType<typeof checkTransition>) => (r.ok ? null : r.error);

describe("آلة حالات الطلب", () => {
  it("لا توجد مرحلة «إعداد عرض السعر» في المسار ولا في الكانبان", () => {
    expect(MAIN_FLOW).not.toContain("QUOTING");
    expect(KANBAN_COLUMNS.flatMap((c) => c.statuses)).not.toContain("QUOTING");
    expect(MAIN_FLOW.slice(0, 4)).toEqual(["NEW", "REVIEW", "AWAITING_CUSTOMER_APPROVAL", "AWAITING_DEPOSIT"]);
  });
  it("تجاوز مرحلة المراجعة يتطلب إدخال قيمة الطلب", () => {
    const c = base({ status: "REVIEW", total: 0 });
    expect(err(checkTransition(c, "AWAITING_CUSTOMER_APPROVAL"))).toBe("أدخل قيمة الطلب أولاً");
    expect(checkTransition({ ...c, total: 500 }, "AWAITING_CUSTOMER_APPROVAL").ok).toBe(true);
    expect(checkTransition(base({ status: "NEW", total: 0 }), "REVIEW").ok).toBe(true);
  });
  it("تمنع تجاوز الدفعة المقدمة قبل تأكيد استلامها، بلا أي استثناء", () => {
    expect(err(checkTransition(base(), "AWAITING_DESIGN"))).toBe("لم يتم تأكيد استلام الدفعة المقدمة بعد");
    // دفع مبلغ كبير لا يكفي وحده — المطلوب تأكيد صريح
    expect(checkTransition(base({ paidAmount: 900 }), "AWAITING_DESIGN", { reason: "عميل مهم" }).ok).toBe(false);
    expect(checkTransition(base({ depositReceived: true }), "AWAITING_DESIGN").ok).toBe(true);
  });
  it("تمنع الإنتاج قبل اعتماد التصميم", () => {
    const c = base({ status: "AWAITING_DESIGN_APPROVAL", depositReceived: true, designTasks: [{ status: "SENT_TO_CUSTOMER" }] });
    expect(checkTransition(c, "MATERIALS_PREP").ok).toBe(false);
    expect(checkTransition({ ...c, designTasks: [{ status: "APPROVED" }] }, "MATERIALS_PREP").ok).toBe(true);
  });
  it("تسمح بالإنتاج بدون تصميم إذا لم يكن مطلوبًا وتمنع مراحل التصميم", () => {
    const c = base({ requiresDesign: false, depositReceived: true });
    expect(checkTransition(c, "MATERIALS_PREP").ok).toBe(true);
    expect(checkTransition(c, "IN_DESIGN").ok).toBe(false);
  });
  it("الإرجاع لمرحلة سابقة يتطلب سببًا", () => {
    const c = base({ status: "IN_PRODUCTION", depositReceived: true, designTasks: [{ status: "APPROVED" }] });
    expect(checkTransition(c, "IN_DESIGN").ok).toBe(false);
    expect(checkTransition(c, "IN_DESIGN", { reason: "خطأ في المقاس" }).ok).toBe(true);
  });
  it("الإيقاف يتطلب سببًا والاستئناف لا يقفز للأمام", () => {
    expect(checkTransition(base(), "ON_HOLD").ok).toBe(false);
    const held = base({ status: "ON_HOLD", statusBeforeHold: "AWAITING_DEPOSIT", depositReceived: true });
    expect(checkTransition(held, "AWAITING_DEPOSIT").ok).toBe(true);
    expect(checkTransition(held, "IN_DESIGN").ok).toBe(false);
  });
  it("الخروج من حالة استثنائية إلى ما قبل موقع الطلب يتطلب سببًا (F14)", () => {
    const rev = base({ status: "NEEDS_REVISION", lastMainStatus: "IN_PRODUCTION", depositReceived: true, designTasks: [{ status: "APPROVED" }] });
    expect(err(checkTransition(rev, "REVIEW"))).toBe("إرجاع الطلب لمرحلة سابقة يتطلب ذكر السبب");
    expect(checkTransition(rev, "REVIEW", { reason: "تغيير المواصفات" }).ok).toBe(true);
    expect(checkTransition(rev, "IN_PRODUCTION").ok).toBe(true);
    // statusBeforeHold القديم لا يُعتمد لغير المعلّق
    const stale = { ...rev, statusBeforeHold: "NEW" as const };
    expect(checkTransition(stale, "REVIEW").ok).toBe(false);
  });
  it("المرتجع لا يعود للإنتاج بدون سبب (F14)", () => {
    const ret = base({ status: "RETURNED", lastMainStatus: "DELIVERED", depositReceived: true, designTasks: [{ status: "APPROVED" }] });
    expect(checkTransition(ret, "PRODUCTION_SCHEDULED").ok).toBe(false);
    expect(checkTransition(ret, "PRODUCTION_SCHEDULED", { reason: "إعادة طباعة بعد المرتجع" }).ok).toBe(true);
  });
  it("الجاهزية للتسليم تتطلب اجتياز الجودة", () => {
    const c = base({ status: "QUALITY_CHECK", depositReceived: true, designTasks: [{ status: "APPROVED" }], productionOrders: [{ status: "QC_PENDING" }] });
    expect(checkTransition(c, "READY_FOR_DELIVERY").ok).toBe(false);
    expect(checkTransition({ ...c, productionOrders: [{ status: "QC_PASSED" }] }, "READY_FOR_DELIVERY").ok).toBe(true);
  });
  it("الإغلاق يتطلب التسليم الكامل والسداد الكامل والصلاحية، والرسالة بلا أرقام", () => {
    const c = base({ status: "DELIVERED", depositReceived: true, paidAmount: 900, designTasks: [{ status: "APPROVED" }], productionOrders: [{ status: "QC_PASSED" }], items: [{ quantity: 10, deliveredQty: 10, cancelledQty: 0 }] });
    const unpaid = err(checkTransition(c, "CLOSED", { canClose: true }));
    expect(unpaid).toBe("الطلب غير مسدد بالكامل");
    expect(unpaid).not.toMatch(/\d/);
    expect(checkTransition({ ...c, paidAmount: 1000 }, "CLOSED", { canClose: false }).ok).toBe(false);
    expect(checkTransition({ ...c, paidAmount: 1000 }, "CLOSED", { canClose: true }).ok).toBe(true);
  });
  it("الإلغاء نهائي ويتطلب صلاحية وسببًا", () => {
    expect(checkTransition(base(), "CANCELLED", { reason: "x" }).ok).toBe(false);
    expect(checkTransition(base(), "CANCELLED", { canCancel: true, reason: "طلب العميل" }).ok).toBe(true);
    expect(checkTransition(base({ status: "CANCELLED" }), "NEW", { reason: "x" }).ok).toBe(false);
  });
  it("التأخير مؤشر مشتق", () => {
    const past = new Date(Date.now() - 3600_000);
    expect(isLate(past, "IN_PRODUCTION")).toBe(true);
    expect(isLate(past, "DELIVERED")).toBe(false);
  });
});

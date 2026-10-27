import type { OrderStatus, Priority, ProductionStatus, DesignStatus, MachineStatus, ItemStatus, AttachmentKind, QcResult } from "@/generated/prisma/enums";

export const ORDER_STATUS: Record<OrderStatus, string> = {
  NEW: "طلب جديد", REVIEW: "مراجعة الطلب", AWAITING_CUSTOMER_APPROVAL: "انتظار موافقة العميل",
  AWAITING_DEPOSIT: "انتظار الدفعة المطلوبة", AWAITING_DESIGN: "بانتظار التصميم", IN_DESIGN: "تحت التصميم",
  DESIGN_REVIEW: "مراجعة التصميم", AWAITING_DESIGN_APPROVAL: "انتظار اعتماد العميل", MATERIALS_PREP: "تجهيز المواد",
  PRODUCTION_SCHEDULED: "جدولة الإنتاج", IN_PRODUCTION: "تحت الإنتاج", FINISHING_PACKAGING: "التشطيب والتغليف",
  QUALITY_CHECK: "فحص الجودة", READY_FOR_DELIVERY: "جاهز للتسليم", OUT_FOR_DELIVERY: "تحت التسليم", DELIVERED: "تم التسليم",
  CLOSED: "مكتمل ومغلق", ON_HOLD: "معلق", NEEDS_REVISION: "يحتاج تعديل", REWORK: "إعادة إنتاج", CANCELLED: "ملغى", RETURNED: "مرتجع",
};
export const PRIORITY: Record<Priority, string> = { LOW: "منخفضة", NORMAL: "عادية", HIGH: "عالية", URGENT: "عاجلة" };
export const PRODUCTION_STATUS: Record<ProductionStatus, string> = {
  PLANNED: "مخطط", SCHEDULED: "مجدول", IN_PROGRESS: "قيد التنفيذ", PAUSED: "متوقف مؤقتًا", COMPLETED: "منتهي",
  QC_PENDING: "بانتظار الجودة", QC_PASSED: "اجتاز الجودة", QC_FAILED: "مرفوض بالجودة", CANCELLED: "ملغى",
};
export const DESIGN_STATUS: Record<DesignStatus, string> = {
  PENDING: "جديدة", IN_PROGRESS: "قيد العمل", INTERNAL_REVIEW: "مراجعة داخلية", SENT_TO_CUSTOMER: "مرسل للعميل",
  CHANGES_REQUESTED: "تعديلات مطلوبة", APPROVED: "معتمد", CANCELLED: "ملغى",
};
export const MACHINE_STATUS: Record<MachineStatus, string> = { RUNNING: "تعمل", AVAILABLE: "متاحة", STOPPED: "متوقفة", MAINTENANCE: "تحت الصيانة" };
export const ITEM_STATUS: Record<ItemStatus, string> = {
  PENDING: "بالانتظار", IN_DESIGN: "في التصميم", DESIGN_APPROVED: "تصميم معتمد", IN_PRODUCTION: "في الإنتاج", QC: "في الجودة", READY: "جاهز",
  PARTIALLY_DELIVERED: "مسلّم جزئيًا", DELIVERED: "مسلّم", CANCELLED: "ملغى", REWORK: "إعادة إنتاج",
};
export const ATTACHMENT_KIND: Record<AttachmentKind, string> = {
  DESIGN: "تصميم", REFERENCE: "مرجع من العميل", PRODUCT_PHOTO: "صورة المنتج", APPROVAL_PROOF: "إثبات موافقة", WORK_ORDER: "أمر عمل",
  QC_REPORT: "تقرير جودة", DELIVERY_NOTE: "سند تسليم", DELIVERY_PROOF: "إثبات تسليم", OTHER: "أخرى",
};
export const QC_RESULT: Record<QcResult, string> = { ACCEPTED: "مقبول", ACCEPTED_WITH_NOTES: "مقبول بملاحظات", REJECTED: "مرفوض", REWORK: "إعادة إنتاج" };
export const DELIVERY_METHOD = { PICKUP: "استلام من المطبعة", COURIER: "توصيل بمندوب", SHIPPING_COMPANY: "شركة شحن", THIRD_PARTY: "طرف خارجي" } as const;

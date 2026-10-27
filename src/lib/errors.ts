import type { ZodError, ZodIssue } from "zod";

export class AppError extends Error {
  constructor(message: string, public code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RULE" = "VALIDATION") {
    super(message);
  }
}
export const forbidden = (m = "ليست لديك صلاحية لتنفيذ هذا الإجراء") => new AppError(m, "FORBIDDEN");
export const notFound = (m = "العنصر غير موجود") => new AppError(m, "NOT_FOUND");
export const rule = (m: string) => new AppError(m, "RULE");

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** أسماء الحقول بالعربية لرسائل التحقق */
const FIELD_LABELS: Record<string, string> = {
  customerId: "العميل", salesRepId: "موظف المبيعات المسؤول", orderType: "نوع الطلب", priority: "الأولوية", dueDate: "موعد التسليم",
  notes: "الملاحظات", items: "المنتجات", name: "الاسم", description: "الوصف", quantity: "الكمية", length: "الطول", width: "العرض",
  height: "الارتفاع", unit: "الوحدة", material: "الخامة", materialThickness: "سماكة الخامة", printType: "نوع الطباعة", colors: "الألوان",
  finishing: "التشطيب", packaging: "التغليف", technicalNotes: "الملاحظات الفنية", total: "قيمة الطلب", paidAmount: "المبلغ المدفوع",
  type: "النوع", phone: "الجوال", whatsapp: "واتساب", email: "البريد", city: "المدينة", address: "العنوان", crNumber: "السجل التجاري",
  vatNumber: "الرقم الضريبي", category: "التصنيف", contactName: "مسؤول التواصل", internalNotes: "الملاحظات الداخلية",
  recipientName: "اسم المستلم", recipientPhone: "جوال المستلم", method: "طريقة التسليم", acceptedQty: "الكمية المقبولة",
  rejectedQty: "الكمية المرفوضة", result: "نتيجة الفحص", rejectReason: "سبب الرفض", stages: "المراحل", plannedStart: "بداية التشغيل",
  plannedEnd: "نهاية التشغيل", machineId: "الآلة", assigneeId: "الموظف",
};

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

export function arabicMessage(i: ZodIssue): string {
  if (hasArabic(i.message)) return i.message;
  switch (i.code) {
    case "invalid_type": return i.received === "undefined" || i.received === "null" ? "مطلوب" : "قيمة غير صالحة";
    case "invalid_date": return "تاريخ غير صالح";
    case "invalid_enum_value": return "اختيار غير صالح";
    case "invalid_string": return "صيغة غير صالحة";
    case "too_small":
      if (i.type === "string") return Number(i.minimum) <= 1 ? "مطلوب" : `يجب ألا يقل عن ${i.minimum} أحرف`;
      if (i.type === "array") return "أضف عنصرًا واحدًا على الأقل";
      return `يجب ألا تقل القيمة عن ${i.minimum}`;
    case "too_big":
      if (i.type === "string") return `النص أطول من المسموح (الحد ${i.maximum} حرفًا)`;
      if (i.type === "array") return `عدد العناصر أكبر من المسموح (${i.maximum})`;
      return `القيمة أكبر من المسموح (الحد ${i.maximum})`;
    case "not_multiple_of": return "قيمة غير صالحة";
    default: return "قيمة غير صالحة";
  }
}

/** أول خطأ تحقق كرسالة عربية تذكر الحقل، مثل: «المنتج 2 — الكمية: يجب ألا تقل القيمة عن 1» */
export function zodMessage(e: ZodError): string {
  const i = e.issues[0];
  if (!i) return "البيانات المدخلة غير صالحة";
  const parts: string[] = [];
  for (let k = 0; k < i.path.length; k++) {
    const seg = i.path[k];
    if (typeof seg === "number") { if (i.path[k - 1] === "items") parts[parts.length - 1] = `المنتج ${seg + 1}`; continue; }
    parts.push(FIELD_LABELS[seg] ?? seg);
  }
  const msg = arabicMessage(i);
  if (!parts.length) return msg;
  // الرسالة التي تبدأ باسم الحقل لا تحتاج تكراره: «المنتج 1 — الكمية يجب أن تكون أكبر من صفر»
  const last = parts[parts.length - 1];
  if (msg.startsWith(last)) return [...parts.slice(0, -1), msg].join(" — ");
  return `${parts.join(" — ")}: ${msg}`;
}

const isZodError = (e: unknown): e is ZodError =>
  !!e && typeof e === "object" && (e as { name?: string }).name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);

/** يغلف إجراء الخادم: يعيد رسالة آمنة للمستخدم ولا يسرّب تفاصيل داخلية */
export async function safe<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (isZodError(e)) return { ok: false, error: zodMessage(e) };
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002")
      return { ok: false, error: "العملية مسجلة مسبقًا أو القيمة مكررة" };
    console.error("[action-error]", e instanceof Error ? e.name + ": " + e.message.slice(0, 200) : "unknown");
    return { ok: false, error: "حدث خطأ غير متوقع. حاول مرة أخرى." };
  }
}

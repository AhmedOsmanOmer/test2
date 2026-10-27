/**
 * مخطط بند الطلب — المصدر الوحيد لحقول البند ورسائلها العربية.
 * يستخدمه إنشاء الطلب واستيراد البنود من Excel. لا يحتوي أي حقل مالي.
 */
import { z } from "zod";

export const MAX_QTY = 1_000_000;
export const optText = (max: number) => z.string().trim().max(max, `النص أطول من المسموح (الحد ${max} حرفًا)`).optional();
const optNum = z.coerce.number({ invalid_type_error: "رقم غير صالح" }).nonnegative("لا يمكن أن تكون القيمة سالبة").max(100_000, "القيمة أكبر من المسموح").optional();

export const itemSchema = z.object({
  name: z.string({ required_error: "اسم المنتج مطلوب" }).trim().min(1, "اسم المنتج مطلوب").max(200, "اسم المنتج أطول من المسموح (الحد 200 حرف)"),
  description: optText(2000),
  categoryId: z.string().optional(),
  quantity: z.coerce.number({ invalid_type_error: "الكمية يجب أن تكون رقمًا" }).int("الكمية يجب أن تكون عددًا صحيحًا")
    .positive("الكمية يجب أن تكون أكبر من صفر").max(MAX_QTY, `الكمية أكبر من المسموح (الحد ${MAX_QTY.toLocaleString("en")})`),
  length: optNum, width: optNum, height: optNum,
  unit: z.string().trim().max(20, "الوحدة أطول من المسموح").default("قطعة"),
  material: optText(100), materialThickness: optText(50), printType: optText(100), colors: optText(100),
  finishing: optText(200), packaging: optText(200), technicalNotes: optText(2000),
});
export type ItemInput = z.input<typeof itemSchema>;
export type ItemData = z.output<typeof itemSchema>;

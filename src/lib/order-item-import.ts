/**
 * أعمدة ملف استيراد بنود الطلب — تطابق حقول مخطط البند (src/lib/order-item.ts) تمامًا، بلا أي عمود مالي.
 * منطق نقي مشترك بين القالب والمحلل والواجهة.
 */
export type ItemColumnKey =
  | "name" | "category" | "quantity" | "unit" | "length" | "width" | "height" | "material" | "materialThickness"
  | "printType" | "colors" | "finishing" | "packaging" | "description" | "technicalNotes";

export interface ItemColumn { key: ItemColumnKey; header: string; required?: boolean; numeric?: boolean; aliases?: string[]; hint: string; width: number }

export const ITEM_COLUMNS: ItemColumn[] = [
  { key: "name", header: "اسم المنتج", required: true, aliases: ["المنتج", "name", "product"], hint: "نص، حتى 200 حرف", width: 28 },
  { key: "category", header: "التصنيف", aliases: ["category"], hint: "اسم تصنيف موجود في النظام", width: 24 },
  { key: "quantity", header: "الكمية", required: true, numeric: true, aliases: ["quantity", "qty"], hint: "عدد صحيح أكبر من صفر", width: 10 },
  { key: "unit", header: "الوحدة", aliases: ["unit"], hint: "الافتراضي «قطعة»", width: 10 },
  { key: "length", header: "الطول", numeric: true, aliases: ["length"], hint: "رقم (سم)", width: 9 },
  { key: "width", header: "العرض", numeric: true, aliases: ["width"], hint: "رقم (سم)", width: 9 },
  { key: "height", header: "الارتفاع", numeric: true, aliases: ["height"], hint: "رقم (سم)", width: 9 },
  { key: "material", header: "الخامة", aliases: ["material"], hint: "نص، حتى 100 حرف", width: 18 },
  { key: "materialThickness", header: "سماكة الخامة", aliases: ["السماكة", "thickness"], hint: "نص، حتى 50 حرفًا", width: 12 },
  { key: "printType", header: "نوع الطباعة", aliases: ["الطباعة", "print type"], hint: "نص، حتى 100 حرف", width: 14 },
  { key: "colors", header: "الألوان", aliases: ["colors"], hint: "نص، حتى 100 حرف", width: 14 },
  { key: "finishing", header: "التشطيب", aliases: ["finishing"], hint: "نص، حتى 200 حرف", width: 18 },
  { key: "packaging", header: "التغليف", aliases: ["packaging"], hint: "نص، حتى 200 حرف", width: 16 },
  { key: "description", header: "الوصف", aliases: ["description"], hint: "نص، حتى 2000 حرف", width: 28 },
  { key: "technicalNotes", header: "ملاحظات فنية", aliases: ["الملاحظات الفنية", "technical notes", "notes"], hint: "نص، حتى 2000 حرف", width: 28 },
];

export const IMPORT_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 500, maxItemsPerOrder: 500, maxCellChars: 4000, maxUnzippedBytes: 60 * 1024 * 1024, maxZipEntries: 2000, timeoutMs: 15_000 } as const;

/** توحيد نص العنوان للمقارنة: بلا نجمة ولا مسافات زائدة، أحرف صغيرة، توحيد الهمزات والتاء المربوطة والياء */
export function normalizeHeader(h: string) {
  return h.replace(/\*/g, "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/** أعمدة مالية ممنوعة: وجود أي منها يرفض الملف كله */
const MONEY_WORDS = ["سعر", "تكلفه", "تكاليف", "قيمه", "مبلغ", "اجمالي", "خصم", "ضريبه", "ريال", "price", "cost", "total", "amount", "discount", "vat", "tax", "sar"];
export function isMoneyHeader(h: string) {
  const n = normalizeHeader(h);
  return MONEY_WORDS.some((w) => (/^[a-z]+$/.test(w) ? new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(n) : n.includes(w)));
}

const LOOKUP = new Map<string, ItemColumnKey>(ITEM_COLUMNS.flatMap((c) => [c.header, ...(c.aliases ?? [])].map((h) => [normalizeHeader(h), c.key] as [string, ItemColumnKey])));
export const columnForHeader = (h: string): ItemColumnKey | undefined => LOOKUP.get(normalizeHeader(h));
export const headerOf = (k: ItemColumnKey) => ITEM_COLUMNS.find((c) => c.key === k)!.header;

/** الأرقام العربية الهندية والفارسية إلى لاتينية */
export function latinDigits(s: string) {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
/** نص رقمي: أرقام لاتينية، الفاصلة العشرية العربية نقطة، وحذف فواصل الآلاف والمسافات */
export function numericText(s: string) {
  return latinDigits(s).replace(/٫/g, ".").replace(/[٬,\s]/g, "");
}

export interface RowError { row: number; column: string; value: string; message: string }

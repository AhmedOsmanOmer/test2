/**
 * محلل ملف Excel لبنود الطلب (خادم فقط). لا يحفظ الملف ولا يقيّم الصيغ.
 * الحماية: الامتداد .xlsx فقط، توقيع ZIP، الحجم، حجم المحتوى بعد فك الضغط (قنبلة ZIP)، عدد الصفوف، طول الخلية، مهلة زمنية.
 */
import { createHash } from "crypto";
import ExcelJS from "exceljs";
import { itemSchema, type ItemData } from "@/lib/order-item";
import { arabicMessage } from "@/lib/errors";
import {
  ITEM_COLUMNS, IMPORT_LIMITS, columnForHeader, headerOf, isMoneyHeader, latinDigits, normalizeHeader, numericText,
  type ItemColumnKey, type RowError,
} from "@/lib/order-item-import";

export interface ParsedRow { row: number; data: ItemData }
export interface ParseResult { fileError?: string; rows: ParsedRow[]; errors: RowError[]; totalRows: number; sha256: string; sizeBytes: number }

const rowSchema = itemSchema.omit({ categoryId: true });
const fail = (fileError: string, bytes: Buffer): ParseResult => ({ fileError, rows: [], errors: [], totalRows: 0, sha256: sha(bytes), sizeBytes: bytes.length });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** يقرأ الدليل المركزي لملف ZIP ويعيد مجموع الأحجام بعد فك الضغط وعدد الملفات (بلا فك ضغط) */
export function zipStats(b: Buffer): { entries: number; unzipped: number } | null {
  const min = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= min; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const entries = b.readUInt16LE(eocd + 10), cdSize = b.readUInt32LE(eocd + 12), cdOff = b.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOff === 0xffffffff || cdOff + cdSize > b.length) return null; // ZIP64 أو تالف
  let p = cdOff, unzipped = 0;
  for (let k = 0; k < entries; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return null;
    const size = b.readUInt32LE(p + 24);
    if (size === 0xffffffff) return null;
    unzipped += size;
    p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return { entries, unzipped };
}

/** فحوصات الملف قبل فتحه */
export function checkUpload(fileName: string, bytes: Buffer): string | null {
  if (!/\.xlsx$/i.test(fileName.trim())) return "نوع الملف غير مدعوم: ارفع ملف Excel بامتداد .xlsx فقط (لا .xls ولا .xlsm ولا .csv)";
  if (bytes.length === 0) return "الملف فارغ";
  if (bytes.length > IMPORT_LIMITS.maxBytes) return "حجم الملف يتجاوز 5 ميجابايت";
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) return "الملف ليس ملف Excel صالحًا (.xlsx)";
  const z = zipStats(bytes);
  if (!z) return "الملف ليس ملف Excel صالحًا (.xlsx)";
  if (z.entries > IMPORT_LIMITS.maxZipEntries || z.unzipped > IMPORT_LIMITS.maxUnzippedBytes) return "محتوى الملف أكبر من المسموح";
  return null;
}

/** قيمة الخلية كنص: نتيجة الصيغة المخزنة فقط (لا تقييم)، والنص الغني والروابط كنص */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? "").join("");
    if ("formula" in v || "sharedFormula" in v) return "result" in v ? cellText(v.result as ExcelJS.CellValue) : "";
    if ("text" in v) return cellText((v as { text: ExcelJS.CellValue }).text);
    if ("error" in v) return "";
  }
  return "";
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("IMPORT_TIMEOUT")), ms))]);

/**
 * يحلل الملف ويتحقق من كل صف بنفس مخطط البند. categories: التصنيفات الموجودة (الاسم ← المعرّف).
 * النتيجة: الصفوف الصالحة وأخطاء الصفوف؛ أو fileError لخطأ يرفض الملف كله.
 */
export async function parseOrderItemsFile(fileName: string, bytes: Buffer, categories: { id: string; name: string }[]): Promise<ParseResult> {
  const pre = checkUpload(fileName, bytes);
  if (pre) return fail(pre, bytes);
  const wb = new ExcelJS.Workbook();
  try {
    await withTimeout(wb.xlsx.load(bytes as unknown as ArrayBuffer), IMPORT_LIMITS.timeoutMs);
  } catch (e) {
    return fail((e as Error).message === "IMPORT_TIMEOUT" ? "استغرقت قراءة الملف وقتًا أطول من المسموح" : "تعذّرت قراءة الملف: تأكد أنه ملف Excel سليم بامتداد .xlsx", bytes);
  }
  const ws = wb.worksheets[0]; // الورقة الأولى فقط
  if (!ws) return fail("الملف لا يحتوي أي ورقة", bytes);

  // صف العناوين: السطر الأول
  const headerRow = ws.getRow(1);
  const cols = new Map<number, ItemColumnKey>();
  const seen = new Map<ItemColumnKey, string>();
  const maxCol = Math.min(ws.actualColumnCount || headerRow.cellCount, 100);
  for (let c = 1; c <= Math.max(maxCol, headerRow.cellCount); c++) {
    const h = cellText(headerRow.getCell(c).value).trim().slice(0, 200);
    if (!h) continue;
    if (isMoneyHeader(h)) return fail(`الملف يحتوي عمودًا ماليًا «${h}». لا تُستورد أسعار أو مبالغ؛ قيمة الطلب يدخلها المخوّلون من صفحة الطلب. احذف العمود وأعد الرفع.`, bytes);
    const key = columnForHeader(h);
    if (!key) return fail(`عمود غير معروف «${h}». استخدم عناوين القالب فقط.`, bytes);
    if (seen.has(key)) return fail(`العمود «${headerOf(key)}» مكرر`, bytes);
    seen.set(key, h); cols.set(c, key);
  }
  if (!cols.size) return fail("لم يُعثر على صف العناوين في السطر الأول. استخدم القالب.", bytes);
  const missing = ITEM_COLUMNS.filter((c) => c.required && !seen.has(c.key)).map((c) => `«${c.header}»`);
  if (missing.length) return fail(`أعمدة مطلوبة غير موجودة: ${missing.join("، ")}`, bytes);

  const catByName = new Map(categories.map((c) => [normalizeHeader(c.name), c.id]));
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  let total = 0;
  // الصفوف الموجودة فقط (eachRow لا ينشئ صفوفًا فارغة حتى آخر خلية منسقة)
  const dataRows: ExcelJS.Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => { if (r > 1) dataRows.push(row); });
  for (const row of dataRows) {
    const r = row.number;
    const raw: Partial<Record<ItemColumnKey, string>> = {};
    let any = false;
    for (const [c, key] of cols) {
      let t = cellText(row.getCell(c).value);
      if (t.length > IMPORT_LIMITS.maxCellChars) t = t.slice(0, IMPORT_LIMITS.maxCellChars);
      t = t.replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " ")).trim();
      if (t) any = true;
      raw[key] = t;
    }
    if (!any) continue; // الصفوف الفارغة تمامًا تُتجاهل
    if (++total > IMPORT_LIMITS.maxRows) return fail(`عدد الصفوف أكبر من المسموح (${IMPORT_LIMITS.maxRows} صف كحد أقصى)`, bytes);

    const input: Record<string, unknown> = {};
    for (const col of ITEM_COLUMNS) {
      if (col.key === "category") continue;
      const v = raw[col.key];
      if (!v) continue;
      input[col.key] = col.numeric ? numericText(v) : latinDigits(v);
    }
    const rowErrors: RowError[] = [];
    let categoryId: string | undefined;
    if (raw.category) {
      categoryId = catByName.get(normalizeHeader(raw.category));
      if (!categoryId) rowErrors.push({ row: r, column: headerOf("category"), value: raw.category.slice(0, 100), message: "التصنيف غير موجود في النظام" });
    }
    // الحقول المطلوبة الفارغة: رسالة واضحة بدل «يجب أن تكون رقمًا»
    const empty = new Set(ITEM_COLUMNS.filter((c) => c.required && !raw[c.key]).map((c) => c.key));
    for (const k of empty) rowErrors.push({ row: r, column: headerOf(k), value: "", message: k === "quantity" ? "الكمية مطلوبة" : "اسم المنتج مطلوب" });
    const parsed = rowSchema.safeParse(input);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const key = i.path[0] as ItemColumnKey;
        if (empty.has(key)) continue;
        rowErrors.push({ row: r, column: headerOf(key), value: String(raw[key] ?? "").slice(0, 100), message: arabicMessage(i) });
      }
    }
    if (rowErrors.length) errors.push(...rowErrors);
    else if (parsed.success) rows.push({ row: r, data: { ...parsed.data, categoryId } });
  }
  if (!total) return fail("لا توجد بنود في الملف (الصفوف بعد العناوين فارغة)", bytes);
  return { rows, errors, totalRows: total, sha256: sha(bytes), sizeBytes: bytes.length };
}

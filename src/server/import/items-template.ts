/** قالب Excel لاستيراد بنود الطلب (خادم فقط): ورقة من اليمين لليسار، عناوين عربية، صف مثال، وقوائم منسدلة */
import ExcelJS from "exceljs";
import { ITEM_COLUMNS, IMPORT_LIMITS } from "@/lib/order-item-import";

const UNITS = ["قطعة", "كرت", "نسخة", "علبة", "كيس", "لوحة", "متر مربع", "رول", "كوب"];
const PRINT_TYPES = ["أوفست", "ديجيتال", "UV", "DTF UV", "سلك سكرين", "فليكسو", "سولفنت"];

export async function buildItemsTemplate(categories: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Printing gate ERP";
  const ws = wb.addWorksheet("بنود الطلب", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = ITEM_COLUMNS.map((c) => ({ header: c.required ? `${c.header}*` : c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  head.height = 22;
  ITEM_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FFFCE7F3" : "FFE0F2FE" } };
    cell.note = c.hint;
  });
  ws.addRow({
    name: "كروت عمل", category: categories[0] ?? "", quantity: 1000, unit: "كرت", length: 9, width: 5, material: "كوشيه مطفي 350 جم",
    printType: "ديجيتال", colors: "4 ألوان وجهين", finishing: "سلوفان مطفي", packaging: "علب 100 كرت", description: "مثال — احذف هذا الصف قبل الرفع",
  });

  // القوائم في ورقة مخفية (الاستيراد يقرأ الورقة الأولى فقط)
  const lists = wb.addWorksheet("قوائم", { state: "hidden" });
  const fill = (col: string, values: string[]) => values.forEach((v, i) => { lists.getCell(`${col}${i + 1}`).value = v; });
  fill("A", categories.length ? categories : ["—"]); fill("B", UNITS); fill("C", PRINT_TYPES);
  const ref = (col: string, n: number) => `'قوائم'!$${col}$1:$${col}$${Math.max(1, n)}`;
  const colLetter = (key: string) => ws.getColumn(key).letter;
  const last = IMPORT_LIMITS.maxRows + 1;
  for (let r = 2; r <= last; r++) {
    ws.getCell(`${colLetter("category")}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [ref("A", categories.length)], showErrorMessage: true, errorTitle: "التصنيف", error: "اختر تصنيفًا من القائمة" };
    ws.getCell(`${colLetter("unit")}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [ref("B", UNITS.length)], showErrorMessage: false };
    ws.getCell(`${colLetter("printType")}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [ref("C", PRINT_TYPES.length)], showErrorMessage: false };
    ws.getCell(`${colLetter("quantity")}${r}`).dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [1, 1_000_000], showErrorMessage: true, errorTitle: "الكمية", error: "عدد صحيح أكبر من صفر" };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

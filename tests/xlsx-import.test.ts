import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseOrderItemsFile, checkUpload } from "@/server/import/order-items-xlsx";
import { buildItemsTemplate } from "@/server/import/items-template";
import { isMoneyHeader, columnForHeader } from "@/lib/order-item-import";

const CATS = [{ id: "cat-cards", name: "طباعة تجارية وورقية" }, { id: "cat-banner", name: "بنرات وفينيل" }];
const HEAD = ["اسم المنتج*", "التصنيف", "الكمية*", "الوحدة", "الطول", "الخامة"];

async function book(rows: unknown[][], opts: { head?: string[]; extraSheet?: boolean; mutate?: (ws: ExcelJS.Worksheet) => void } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("بنود");
  ws.addRow(opts.head ?? HEAD);
  rows.forEach((r) => ws.addRow(r));
  opts.mutate?.(ws);
  if (opts.extraSheet) { const x = wb.addWorksheet("أخرى"); x.addRow(["سعر", "total"]); x.addRow(["غير مقروء", 999]); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const parse = (b: Buffer, name = "items.xlsx") => parseOrderItemsFile(name, b, CATS);

describe("محلل ملف Excel لبنود الطلب", () => {
  it("ملف صالح: يقرأ البنود ويربط التصنيف بالمعرّف", async () => {
    const r = await parse(await book([["كروت عمل", "طباعة تجارية وورقية", 1000, "كرت", 9, "كوشيه"], ["  بنر خارجي  ", "", 2, "", "", ""]]));
    expect(r.fileError).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.totalRows).toBe(2);
    expect(r.rows[0]).toMatchObject({ row: 2, data: { name: "كروت عمل", categoryId: "cat-cards", quantity: 1000, unit: "كرت", length: 9, material: "كوشيه" } });
    expect(r.rows[1].data).toMatchObject({ name: "بنر خارجي", quantity: 2, unit: "قطعة" });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("الأرقام العربية الهندية والفاصلة العشرية العربية", async () => {
    const r = await parse(await book([["ملصق", "", "١٬٢٠٠", "", "٩٫٥", ""]]));
    expect(r.rows[0].data).toMatchObject({ quantity: 1200, length: 9.5 });
  });
  it("عمود مطلوب مفقود يرفض الملف", async () => {
    const r = await parse(await book([["ملصق", "", ""]], { head: ["اسم المنتج", "التصنيف", "الوحدة"] }));
    expect(r.fileError).toBe("أعمدة مطلوبة غير موجودة: «الكمية»");
  });
  it("عمود غير معروف أو مكرر يرفض الملف", async () => {
    expect((await parse(await book([["أ", 1, "x"]], { head: ["اسم المنتج", "الكمية", "اللون المفضل"] }))).fileError).toBe("عمود غير معروف «اللون المفضل». استخدم عناوين القالب فقط.");
    expect((await parse(await book([["أ", 1, 2]], { head: ["اسم المنتج", "الكمية", "Qty"] }))).fileError).toBe("العمود «الكمية» مكرر");
  });
  it.each(["سعر الوحدة", "التكلفة", "قيمة البند", "المبلغ", "الإجمالي", "خصم", "الضريبة", "Unit Price", "COST", "Total", "amount", "Discount", "VAT"])(
    "يرفض الملف كله عند وجود عمود مالي: %s", async (h) => {
      const r = await parse(await book([["أ", 1, 50]], { head: ["اسم المنتج", "الكمية", h] }));
      expect(r.fileError).toContain("عمودًا ماليًا");
      expect(r.rows).toEqual([]);
    });
  it("عناوين البنود العادية ليست مالية", () => {
    for (const h of ["الكمية", "التصنيف", "الوحدة", "ملاحظات فنية", "نوع الطباعة", "Quantity", "notes"]) expect(isMoneyHeader(h)).toBe(false);
    expect(columnForHeader("اسم المنتج*")).toBe("name");
  });
  it.each(["items.xls", "items.xlsm", "items.csv", "items.xlsx.exe", "items"])("يرفض الامتداد %s", async (name) => {
    const r = await parse(await book([["أ", "", 1]]), name);
    expect(r.fileError).toMatch(/xlsx فقط/);
  });
  it("ملف ليس ZIP بامتداد .xlsx", async () => {
    expect((await parse(Buffer.from("name,quantity\nكروت,5\n"))).fileError).toBe("الملف ليس ملف Excel صالحًا (.xlsx)");
    expect((await parse(Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(100)]))).fileError).toBe("الملف ليس ملف Excel صالحًا (.xlsx)");
  });
  it("الصفوف الفارغة تمامًا تُتجاهل، ورقم الصف الحقيقي في الأخطاء", async () => {
    const r = await parse(await book([["أ", "", 1], [], ["", "", ""], ["ب", "", 0]]));
    expect(r.totalRows).toBe(2);
    expect(r.errors).toEqual([{ row: 5, column: "الكمية", value: "0", message: "الكمية يجب أن تكون أكبر من صفر" }]);
  });
  it("خلية صيغة: تُقرأ النتيجة المخزنة فقط ولا تُقيَّم", async () => {
    const b = await book([["أ", "", 0], ["ب", "", 0]], { mutate: (ws) => {
      ws.getCell("C2").value = { formula: "10*5", result: 50 } as ExcelJS.CellFormulaValue;
      ws.getCell("C3").value = { formula: "10*5" } as ExcelJS.CellFormulaValue; // بلا نتيجة مخزنة
    } });
    const r = await parse(b);
    expect(r.rows.map((x) => x.data.quantity)).toEqual([50]);
    expect(r.errors).toEqual([{ row: 3, column: "الكمية", value: "", message: "الكمية مطلوبة" }]);
  });
  it("الأوراق الإضافية تُتجاهل (الأولى فقط)", async () => {
    const r = await parse(await book([["أ", "", 3]], { extraSheet: true }));
    expect(r.fileError).toBeUndefined();
    expect(r.rows).toHaveLength(1);
  });
  it("أكثر من 500 صف يرفض الملف", async () => {
    const r = await parse(await book(Array.from({ length: 501 }, (_, i) => [`بند ${i}`, "", 1])));
    expect(r.fileError).toBe("عدد الصفوف أكبر من المسموح (500 صف كحد أقصى)");
  });
  it("نص طويل جدًا وتصنيف غير موجود: أخطاء صفوف بالعربية", async () => {
    const r = await parse(await book([["س".repeat(5000), "تصنيف وهمي", 1]]));
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => [e.row, e.column, e.message])).toEqual([
      [2, "التصنيف", "التصنيف غير موجود في النظام"],
      [2, "اسم المنتج", "اسم المنتج أطول من المسموح (الحد 200 حرف)"],
    ]);
    expect(r.errors[1].value.length).toBe(100);
  });
  it("كمية كسرية أو نصية أو ضخمة", async () => {
    const r = await parse(await book([["أ", "", 1.5], ["ب", "", "كثير"], ["ج", "", 5_000_000]]));
    expect(r.errors.map((e) => e.message)).toEqual(["الكمية يجب أن تكون عددًا صحيحًا", "الكمية يجب أن تكون رقمًا", "الكمية أكبر من المسموح (الحد 1,000,000)"]);
  });
  it("أكبر من 5 ميجابايت", () => {
    const big = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(5 * 1024 * 1024)]);
    expect(checkUpload("big.xlsx", big)).toBe("حجم الملف يتجاوز 5 ميجابايت");
  });
  it("القالب: ورقة RTL بعناوين القالب، وصف المثال صالح", async () => {
    const t = await buildItemsTemplate(CATS.map((c) => c.name));
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t as unknown as ArrayBuffer);
    expect(wb.worksheets[0].views[0].rightToLeft).toBe(true);
    expect(wb.worksheets[0].getRow(1).getCell(1).value).toBe("اسم المنتج*");
    const r = await parse(t, "template.xlsx");
    expect(r.fileError).toBeUndefined();
    expect(r.rows[0].data).toMatchObject({ name: "كروت عمل", quantity: 1000, categoryId: "cat-cards" });
  });
});

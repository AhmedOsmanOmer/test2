import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodMessage, safe } from "@/lib/errors";

const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  dueDate: z.coerce.date(),
  items: z.array(z.object({ name: z.string().max(5), quantity: z.coerce.number().int().positive("الكمية يجب أن تكون أكبر من صفر") })),
});
const msg = (input: unknown) => { const r = schema.safeParse(input); if (r.success) throw new Error("expected failure"); return zodMessage(r.error); };

describe("رسائل التحقق بالعربية (F06)", () => {
  it("تذكر المنتج والحقل دون تكرار اسم الحقل", () => {
    expect(msg({ customerId: "c", dueDate: "2030-01-01", items: [{ name: "a", quantity: 1 }, { name: "b", quantity: 0 }] }))
      .toBe("المنتج 2 — الكمية يجب أن تكون أكبر من صفر");
  });
  it("تترجم رسائل zod الافتراضية الإنجليزية", () => {
    expect(msg({ customerId: "c", dueDate: "x", items: [] })).toBe("موعد التسليم: تاريخ غير صالح");
    expect(msg({ customerId: "c", dueDate: "2030-01-01", items: [{ name: "طويل جدًا", quantity: 1 }] })).toBe("المنتج 1 — الاسم: النص أطول من المسموح (الحد 5 حرفًا)");
    expect(msg({ dueDate: "2030-01-01", items: [] })).toBe("العميل: مطلوب");
  });
  it("safe() تعيد الرسالة العربية بدل «حدث خطأ غير متوقع»", async () => {
    const r = await safe(async () => schema.parse({ customerId: "", dueDate: "2030-01-01", items: [] }));
    expect(r).toEqual({ ok: false, error: "العميل: اختر العميل" });
  });
});

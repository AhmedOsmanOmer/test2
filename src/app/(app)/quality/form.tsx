"use client";
import { useState } from "react";
import { FormAction } from "@/components/client";
import { Field } from "@/components/ui";
import { inspectAction } from "@/server/actions";

const CHECKS = { dimensions: "مطابقة المقاسات", colors: "مطابقة الألوان", printQuality: "جودة الطباعة", materials: "جودة الخامات", finishing: "سلامة التشطيب", packaging: "سلامة التغليف", quantity: "مطابقة الكمية" } as const;
export function InspectForm({ id, produced }: { id: string; produced: number }) {
  const [accepted, setAccepted] = useState(produced);
  return (
    <FormAction className="space-y-3" action={(f) => inspectAction({
      productionOrderId: id, acceptedQty: accepted, rejectedQty: produced - accepted,
      checks: Object.fromEntries(Object.keys(CHECKS).map((k) => [k, f.get(k) === "on"])) as never,
      result: f.get("result") as never, rejectReason: String(f.get("reason") || "") || undefined, notes: String(f.get("notes") || "") || undefined,
    })}>
      <div className="flex flex-wrap gap-3">{Object.entries(CHECKS).map(([k, v]) => <label key={k} className="flex items-center gap-1.5 rounded border border-paper-line px-2.5 py-1.5 text-sm"><input type="checkbox" name={k} defaultChecked /> {v}</label>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label={`المقبول (من ${produced})`}><input type="number" min={0} max={produced} value={accepted} onChange={(e) => setAccepted(Math.min(produced, Math.max(0, Number(e.target.value))))} className="input" /></Field>
        <Field label="المرفوض"><input readOnly value={produced - accepted} className="input bg-paper" /></Field>
        <Field label="النتيجة"><select name="result" className="input" defaultValue="ACCEPTED"><option value="ACCEPTED">مقبول</option><option value="ACCEPTED_WITH_NOTES">مقبول مع ملاحظات</option><option value="REWORK">يحتاج إعادة عمل</option><option value="REJECTED">مرفوض</option></select></Field>
        <Field label="سبب الرفض"><input name="reason" className="input" list="qc-reasons" /><datalist id="qc-reasons"><option value="اختلاف الألوان" /><option value="مقاس غير مطابق" /><option value="عيب في الطباعة" /><option value="عيب في التشطيب" /><option value="تلف في التغليف" /></datalist></Field>
        <Field label="ملاحظات"><input name="notes" className="input" /></Field>
      </div>
      <p className="text-xs text-ink-faint">عند الرفض أو إعادة العمل يُنشأ تلقائيًا أمر إعادة إنتاج بالكمية المرفوضة ومهمة تصحيحية مرتبطة بأمر التشغيل الأصلي. صور الفحص تُرفع من تبويب «الملفات» في الطلب بنوع «تقرير جودة».</p>
      <button className="btn-primary">حفظ نتيجة الفحص</button>
    </FormAction>
  );
}

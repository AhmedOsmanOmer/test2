"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrderAction } from "@/server/actions";
import { Card, Field } from "@/components/ui";
import { ImportItems } from "@/components/import-items";
import type { ItemData } from "@/lib/order-item";

export type ItemDraft = {
  name: string; description: string; categoryId: string; quantity: number; unit: string; length?: number; width?: number; height?: number;
  material: string; materialThickness?: string; printType: string; colors: string; finishing: string; packaging: string; technicalNotes: string;
};
const blank = (): ItemDraft => ({ name: "", description: "", categoryId: "", quantity: 1, unit: "قطعة", material: "", printType: "", colors: "", finishing: "", packaging: "", technicalNotes: "" });

/** reps = null: الطلب يُسنَد لمنشئه. showValue: حقل «قيمة الطلب» لمن يملك orders.edit_value فقط */
export function OrderForm({ customers, categories, reps, me, minDate, initialCustomer, initialItems, showValue, canImport }: {
  customers: { id: string; name: string; code: string }[]; categories: { id: string; name: string }[]; reps: { id: string; fullName: string }[] | null;
  me: string; minDate: string; initialCustomer?: string; initialItems?: ItemDraft[]; showValue: boolean; canImport: boolean;
}) {
  const [items, setItems] = useState<ItemDraft[]>(initialItems?.length ? initialItems : [blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (i: number, patch: Partial<ItemDraft>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  // البنود المستوردة تُضاف بعد الموجودة (ويُحذف الصف الفارغ الافتراضي فقط)
  const addImported = (rows: ItemData[]) => setItems((xs) => [
    ...xs.filter((x) => x.name.trim()),
    ...rows.map((r) => ({ ...blank(), ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null)), categoryId: r.categoryId ?? "" }) as ItemDraft),
  ]);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      start(async () => {
        const r = await createOrderAction({
          customerId: String(f.get("customerId") ?? ""), salesRepId: reps ? String(f.get("salesRepId") ?? "") || undefined : undefined, orderType: String(f.get("orderType") || "") || undefined,
          priority: f.get("priority") as never, dueDate: new Date(String(f.get("dueDate"))), requiresDesign: f.get("requiresDesign") === "on",
          requiresQC: f.get("requiresQC") === "on", total: showValue && f.get("total") ? Number(f.get("total")) : undefined, notes: String(f.get("notes") || "") || undefined,
          items: items.map((i) => ({ ...i, categoryId: i.categoryId || undefined })),
        });
        if (r.ok) router.push(`/orders/${r.data!.id}`); else setErr(r.error);
      });
    }} className="space-y-4">
      <Card title="البيانات الأساسية">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="العميل *" className="sm:col-span-2 lg:col-span-2"><select name="customerId" className="input" defaultValue={initialCustomer ?? ""} required><option value="" disabled>اختر العميل</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</select></Field>
          {reps && <Field label="موظف المبيعات المسؤول"><select name="salesRepId" className="input" defaultValue={reps.some((r) => r.id === me) ? me : reps[0]?.id}>{reps.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}</select></Field>}
          <Field label="نوع الطلب"><input name="orderType" className="input" list="types" /><datalist id="types">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist></Field>
          <Field label="الأولوية"><select name="priority" className="input" defaultValue="NORMAL"><option value="LOW">منخفضة</option><option value="NORMAL">عادية</option><option value="HIGH">عالية</option><option value="URGENT">عاجلة</option></select></Field>
          <Field label="تاريخ التسليم المطلوب *"><input type="date" name="dueDate" className="input" required min={minDate} /></Field>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="requiresDesign" defaultChecked /> يتطلب تصميمًا</label>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="requiresQC" defaultChecked /> يتطلب فحص جودة</label>
          <Field label="ملاحظات عامة" className="sm:col-span-full lg:col-span-4"><textarea name="notes" className="input" rows={2} /></Field>
        </div>
      </Card>

      {canImport && <Card title="تعبئة البنود من Excel (اختياري)"><ImportItems onRows={addImported} /></Card>}
      {items.map((it, i) => (
        <Card key={i} title={`المنتج ${i + 1}${it.name ? ` — ${it.name}` : ""}`} actions={items.length > 1 && <button type="button" className="btn-ghost text-magenta-process" onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}>حذف المنتج</button>}>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label="اسم المنتج *" className="sm:col-span-2 lg:col-span-2"><input className="input" value={it.name} onChange={(e) => set(i, { name: e.target.value })} required /></Field>
            <Field label="التصنيف" className="sm:col-span-2 lg:col-span-2"><select className="input" value={it.categoryId} onChange={(e) => set(i, { categoryId: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="الكمية *"><input type="number" min={1} className="input" value={it.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} required /></Field>
            <Field label="الوحدة"><input className="input" value={it.unit} onChange={(e) => set(i, { unit: e.target.value })} /></Field>
            <Field label="الطول (سم)"><input type="number" step="0.1" className="input" value={it.length ?? ""} onChange={(e) => set(i, { length: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="العرض (سم)"><input type="number" step="0.1" className="input" value={it.width ?? ""} onChange={(e) => set(i, { width: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="الارتفاع (سم)"><input type="number" step="0.1" className="input" value={it.height ?? ""} onChange={(e) => set(i, { height: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="الخامة"><input className="input" value={it.material} onChange={(e) => set(i, { material: e.target.value })} /></Field>
            <Field label="سماكة الخامة"><input className="input" value={it.materialThickness ?? ""} onChange={(e) => set(i, { materialThickness: e.target.value })} /></Field>
            <Field label="نوع الطباعة"><input className="input" list="print" value={it.printType} onChange={(e) => set(i, { printType: e.target.value })} /></Field>
            <Field label="الألوان"><input className="input" value={it.colors} onChange={(e) => set(i, { colors: e.target.value })} /></Field>
            <Field label="التشطيب" className="sm:col-span-2 lg:col-span-2"><input className="input" value={it.finishing} onChange={(e) => set(i, { finishing: e.target.value })} /></Field>
            <Field label="التغليف" className="sm:col-span-2 lg:col-span-2"><input className="input" value={it.packaging} onChange={(e) => set(i, { packaging: e.target.value })} /></Field>
            <Field label="الوصف" className="sm:col-span-full lg:col-span-3"><textarea className="input" rows={2} value={it.description} onChange={(e) => set(i, { description: e.target.value })} /></Field>
            <Field label="ملاحظات فنية" className="sm:col-span-full lg:col-span-3"><textarea className="input" rows={2} value={it.technicalNotes} onChange={(e) => set(i, { technicalNotes: e.target.value })} /></Field>
          </div>
        </Card>
      ))}
      <datalist id="print"><option value="أوفست" /><option value="ديجيتال" /><option value="UV" /><option value="DTF UV" /><option value="سلك سكرين" /><option value="فليكسو" /></datalist>
      <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setItems((xs) => [...xs, blank()])}>إضافة منتج آخر</button>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          {showValue ? <Field label="قيمة الطلب (ر.س)" hint="يمكن إدخالها أو تعديلها لاحقًا من صفحة الطلب"><input type="number" name="total" min={0} step="0.01" inputMode="decimal" className="input sm:w-48" /></Field> : <span className="hidden sm:block" />}
          <button className="btn-primary w-full sm:w-auto" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ الطلب"}</button>
        </div>
        {err && <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</p>}
      </Card>
    </form>
  );
}

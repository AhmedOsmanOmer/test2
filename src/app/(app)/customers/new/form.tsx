"use client";
import { useFormState, useFormStatus } from "react-dom";
import { createCustomerAction } from "@/server/actions";
import { Field } from "@/components/ui";

function Save() { const { pending } = useFormStatus(); return <button className="btn-primary" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ العميل"}</button>; }
export function CustomerForm() {
  const [state, action] = useFormState(createCustomerAction, null);
  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Field label="اسم العميل أو الشركة *" className="sm:col-span-2 lg:col-span-2"><input name="name" className="input" required /></Field>
      <Field label="النوع"><select name="type" className="input"><option value="COMPANY">شركة</option><option value="INDIVIDUAL">فرد</option></select></Field>
      <Field label="رقم الجوال"><input name="phone" className="input" dir="ltr" placeholder="05xxxxxxxx" /></Field>
      <Field label="رقم واتساب"><input name="whatsapp" className="input" dir="ltr" /></Field>
      <Field label="البريد الإلكتروني"><input name="email" type="email" className="input" dir="ltr" /></Field>
      <Field label="المدينة"><input name="city" className="input" /></Field>
      <Field label="العنوان" className="sm:col-span-2 lg:col-span-2"><input name="address" className="input" /></Field>
      <Field label="السجل التجاري"><input name="crNumber" className="input" dir="ltr" /></Field>
      <Field label="الرقم الضريبي" hint="15 رقمًا يبدأ وينتهي بـ 3"><input name="vatNumber" className="input" dir="ltr" /></Field>
      <Field label="مسؤول التواصل"><input name="contactName" className="input" /></Field>
      <Field label="التصنيف"><input name="category" className="input" list="cats" /><datalist id="cats"><option value="VIP" /><option value="جهة حكومية" /><option value="وكالة إعلانية" /><option value="عميل جديد" /></datalist></Field>
      <Field label="ملاحظات داخلية" className="sm:col-span-full lg:col-span-3"><textarea name="internalNotes" className="input" rows={3} /></Field>
      {state && !state.ok && <p role="alert" className="sm:col-span-full lg:col-span-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</p>}
      <div className="sm:col-span-full lg:col-span-3"><Save /></div>
    </form>
  );
}

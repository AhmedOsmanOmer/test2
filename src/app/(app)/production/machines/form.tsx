"use client";
import { useFormState } from "react-dom";
import { saveMachineAction } from "@/server/actions";
import { Field } from "@/components/ui";
import { Notice } from "@/components/client";

export function MachineForm({ staff }: { staff: { id: string; fullName: string }[] }) {
  const [state, action] = useFormState(saveMachineAction, null);
  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Field label="الرمز"><input name="code" className="input" required dir="ltr" /></Field>
      <Field label="الاسم" className="sm:col-span-2 lg:col-span-2"><input name="name" className="input" required /></Field>
      <Field label="النوع"><input name="type" className="input" required /></Field>
      <Field label="الطاقة/ساعة"><input name="capacityPerHour" type="number" className="input" /></Field>
      <Field label="وحدة الطاقة"><input name="capacityUnit" className="input" /></Field>
      <Field label="المسؤول" className="sm:col-span-2 lg:col-span-2"><select name="responsibleId" className="input"><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></Field>
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="showOnBoard" defaultChecked /> تظهر على الشاشة</label>
      <div className="flex items-end"><button className="btn-primary">حفظ</button></div>
      <div className="sm:col-span-full lg:col-span-6"><Notice r={state} /></div>
    </form>
  );
}

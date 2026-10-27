"use client";
import { useFormState } from "react-dom";
import { createUserAction } from "@/server/actions";
import { Field } from "@/components/ui";
import { Notice } from "@/components/client";

export function NewUser({ roles }: { roles: { key: string; name: string }[] }) {
  const [state, action] = useFormState(createUserAction, null);
  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <Field label="اسم المستخدم (إنجليزي)"><input name="username" className="input" dir="ltr" required /></Field>
      <Field label="الاسم الكامل"><input name="fullName" className="input" required /></Field>
      <Field label="الدور"><select name="role" className="input">{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field>
      <Field label="كلمة مرور مؤقتة"><input name="password" type="text" className="input" dir="ltr" minLength={10} required /></Field>
      <div className="flex items-end"><button className="btn-primary">إنشاء</button></div>
      <div className="sm:col-span-full lg:col-span-5"><Notice r={state} /></div>
    </form>
  );
}

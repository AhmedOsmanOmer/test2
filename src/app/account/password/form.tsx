"use client";
import { useFormState, useFormStatus } from "react-dom";
import { changePasswordAction } from "@/server/actions";
import { Field } from "@/components/ui";

function Save() { const { pending } = useFormStatus(); return <button className="btn-primary w-full" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}</button>; }
export function PasswordForm() {
  const [state, action] = useFormState(changePasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="كلمة المرور الحالية"><input name="current" type="password" className="input" dir="ltr" autoComplete="current-password" required /></Field>
      <Field label="كلمة المرور الجديدة" hint="10 أحرف على الأقل، تجمع حروفًا وأرقامًا"><input name="next" type="password" className="input" dir="ltr" autoComplete="new-password" minLength={10} required /></Field>
      <Field label="تأكيد كلمة المرور الجديدة"><input name="confirm" type="password" className="input" dir="ltr" autoComplete="new-password" required /></Field>
      {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</p>}
      <Save />
    </form>
  );
}

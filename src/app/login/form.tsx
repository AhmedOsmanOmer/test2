"use client";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "@/server/actions";

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn-primary w-full" disabled={pending}>{pending ? "جارٍ التحقق…" : "دخول"}</button>;
}
export function LoginForm({ next }: { next: string }) {
  const [state, action] = useFormState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block"><span className="label">اسم المستخدم</span><input name="username" className="input" dir="ltr" autoComplete="username" required autoFocus /></label>
      <label className="block"><span className="label">كلمة المرور</span><input name="password" type="password" className="input" dir="ltr" autoComplete="current-password" required /></label>
      {state && !state.ok && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.error}</p>}
      <Submit />
    </form>
  );
}

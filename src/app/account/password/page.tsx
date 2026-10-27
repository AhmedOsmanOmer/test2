import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth";
import { PasswordForm } from "./form";

export const dynamic = "force-dynamic";
export default async function ChangePassword() {
  const a = await currentActor();
  if (!a) redirect("/login");
  return (
    <main className="flex min-h-screen items-start justify-center px-4 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] sm:items-center sm:p-8">
      <div className="card w-full max-w-md p-5 sm:p-8">
        <div className="cmyk-strip -mx-5 -mt-5 mb-6 h-1.5 rounded-t-lg sm:-mx-8 sm:-mt-8" />
        <h1 className="text-xl font-bold">{a.mustChangePassword ? "غيّر كلمة المرور المؤقتة" : "تغيير كلمة المرور"}</h1>
        <p className="mb-5 mt-1 text-sm text-ink-soft">{a.mustChangePassword ? "حسابك يستخدم كلمة مرور أنشأها المدير. اختر كلمة مرور خاصة بك للمتابعة." : "سيتم تسجيل خروجك من الأجهزة الأخرى."}</p>
        <PasswordForm />
      </div>
    </main>
  );
}

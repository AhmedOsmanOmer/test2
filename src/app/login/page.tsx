import { LoginForm } from "./form";

export default function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_520px]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="cmyk-strip absolute inset-x-0 top-0 h-1.5" />
        <div>
          <p className="text-sm text-white/60">Printing gate ERP</p>
          <h1 className="mt-3 max-w-md text-4xl font-bold leading-tight">من استلام الطلب حتى آخر ريال، في مكان واحد.</h1>
        </div>
        <svg viewBox="0 0 120 120" className="h-40 w-40 text-white/15" aria-hidden>
          <circle cx="60" cy="60" r="34" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M60 6v108M6 60h108" stroke="currentColor" strokeWidth="3" />
        </svg>
        <p className="text-sm text-white/50">شركة بوابة الطباعة للدعاية والإعلان — نظام داخلي للموظفين المصرح لهم فقط</p>
      </section>
      <section className="flex flex-col items-center justify-center px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:p-12">
        {/* الجوال: شريط الهوية مختصرًا */}
        <div className="mb-8 w-full max-w-sm lg:hidden">
          <div className="cmyk-strip mb-4 h-1.5 rounded" />
          <p className="text-xs text-ink-soft" dir="ltr">Printing gate ERP</p>
          <p className="text-lg font-bold">بوابة الطباعة</p>
        </div>
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">تسجيل الدخول</h2>
          <p className="mb-6 mt-1 text-sm text-ink-soft">استخدم الحساب الذي أنشأه لك مدير النظام.</p>
          <LoginForm next={searchParams.next ?? "/"} />
        </div>
      </section>
    </main>
  );
}

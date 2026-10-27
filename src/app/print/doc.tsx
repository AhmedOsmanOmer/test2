import { db } from "@/lib/db";

export async function company() {
  const rows = await db.systemSetting.findMany({ where: { key: { startsWith: "company." } } });
  const g = (k: string) => String(rows.find((r) => r.key === `company.${k}`)?.value ?? "");
  return { nameAr: g("nameAr") || "شركة بوابة الطباعة للدعاية والإعلان", nameEn: g("nameEn") || "Printing gate", vat: g("vatNumber"), cr: g("crNumber"), address: g("address"), phone: g("phone") };
}

export async function Doc({ title, number, children }: { title: string; number: string; children: React.ReactNode }) {
  const c = await company();
  return (
    // على الشاشة الصغيرة يتسع للعرض المتاح؛ عند الطباعة A4 تمامًا كما كان
    <div className="mx-auto w-full max-w-[210mm] bg-white p-4 text-[13px] text-black shadow sm:min-h-[297mm] sm:p-[14mm] print:w-[210mm] print:max-w-none print:p-[14mm] print:shadow-none">
      <div className="cmyk-strip mb-4 h-1.5" />
      <header className="flex flex-col-reverse items-start justify-between gap-3 border-b border-black/20 pb-3 sm:flex-row print:flex-row">
        <div><div className="text-xl font-bold">{c.nameAr}</div><div className="text-xs" dir="ltr">{c.nameEn}</div>
          <div className="mt-1 text-xs">{c.address}{c.phone && ` — ${c.phone}`}</div>
          <div className="text-xs">{c.vat && `الرقم الضريبي: ${c.vat}`}{c.cr && ` — س.ت: ${c.cr}`}</div></div>
        <div className="text-left"><div className="text-2xl font-bold">{title}</div><div className="font-mono" dir="ltr">{number}</div></div>
      </header>
      {children}
      <div className="no-print mt-8 text-center"><button className="btn-primary min-h-[44px] w-full sm:w-auto lg:min-h-0" id="print-btn">طباعة / حفظ PDF</button></div>
      <script dangerouslySetInnerHTML={{ __html: `document.getElementById('print-btn')?.addEventListener('click',function(){window.print()})` }} />
    </div>
  );
}

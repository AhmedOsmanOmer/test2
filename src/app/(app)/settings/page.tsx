import Link from "next/link";
import { requireActor, pageAny } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, TableScroll } from "@/components/ui";

export default async function Settings() {
  const a = await requireActor();
  pageAny(a, "settings.manage", "users.manage", "liveboard.manage", "machines.manage", "audit.view");
  const settings = can(a, "settings.manage") ? await db.systemSetting.findMany({ orderBy: { key: "asc" } }) : [];
  const links: [string, string, string, boolean][] = [
    ["/settings/general", "الإعدادات العامة", "بيانات الشركة، الضريبة، ساعات العمل، سياسة الدفعات، أسعار الحاسبة", can(a, "settings.manage")],
    ["/settings/users", "المستخدمون والصلاحيات", "إنشاء الحسابات وتعطيلها وإعادة تعيين كلمات المرور", can(a, "users.manage")],
    ["/settings/live-board", "شاشة الإنتاج المباشر", "روابط الأجهزة، الأقسام المعروضة، الآلات، الألوان، فترة التحديث", can(a, "liveboard.manage")],
    ["/production/machines", "الآلات والمعدات", "إضافة الآلات وحالتها وسجل الصيانة", can(a, "machines.manage")],
    ["/settings/audit", "سجل التدقيق", "عمليات الدخول وكل التعديلات الحساسة", can(a, "audit.view")],
  ];
  return (
    <>
      <PageHeader title="الإعدادات" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">{links.filter((l) => l[3]).map(([href, t, d]) => <Link key={href} href={href} className="card p-5 hover:border-cyan-process"><div className="font-semibold">{t}</div><div className="text-sm text-ink-soft">{d}</div></Link>)}</div>
      {settings.length > 0 && <div className="mt-4"><Card title="القيم المخزنة حاليًا">
        <TableScroll><table className="w-full text-sm"><tbody>{settings.map((s) => <tr key={s.key} className="border-b border-paper-line/60"><td className="td font-mono text-xs" dir="ltr">{s.key}</td><td className="td" dir="auto">{typeof s.value === "object" ? JSON.stringify(s.value) : String(s.value)}</td></tr>)}</tbody></table></TableScroll>
        
      </Card></div>}
    </>
  );
}

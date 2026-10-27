import Link from "next/link";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { listCustomers } from "@/server/services/customers";
import { PageHeader, Card, Empty, Pager, Badge, ResponsiveTable } from "@/components/ui";
import { date } from "@/lib/format";

export default async function Customers({ searchParams }: { searchParams: { q?: string; page?: string } }) {
  const a = await requireActor(); pagePerm(a, "customers.view");
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const { rows, total } = await listCustomers(a, searchParams.q, page);
  return (
    <>
      <PageHeader title="العملاء" subtitle={`${total} عميل`} actions={can(a, "customers.manage") && <Link href="/customers/new" className="btn-primary">عميل جديد</Link>} />
      <Card>
        <form className="mb-3 flex flex-col gap-2 sm:flex-row"><input name="q" defaultValue={searchParams.q} className="input sm:max-w-sm" placeholder="الاسم، رقم العميل، الجوال، الرقم الضريبي" aria-label="بحث في العملاء" /><button className="btn-ghost">بحث</button></form>
        {rows.length ? (
          <ResponsiveTable minWidth={720} cards={rows.map((c) => ({
            key: c.id, href: `/customers/${c.id}`, title: c.name, badge: c.category ? <Badge>{c.category}</Badge> : undefined,
            lines: [`${c.code} — ${c.type === "COMPANY" ? "شركة" : "فرد"}${c.city ? ` — ${c.city}` : ""}`, <span key="p" dir="ltr">{c.phone ?? ""}</span>, `الطلبات ${c._count.orders} — آخر طلب ${date(c.orders[0]?.createdAt)}`],
          }))}>
          <table className="w-full">
            <thead><tr className="border-b border-paper-line"><th className="th">الرقم</th><th className="th">العميل</th><th className="th">النوع</th><th className="th">الجوال</th><th className="th">المدينة</th><th className="th">التصنيف</th><th className="th">الطلبات</th><th className="th">آخر طلب</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="border-b border-paper-line/60 hover:bg-paper">
                <td className="td tabular-nums">{c.code}</td>
                <td className="td"><Link href={`/customers/${c.id}`} className="font-medium text-cyan-deep">{c.name}</Link></td>
                <td className="td">{c.type === "COMPANY" ? "شركة" : "فرد"}</td>
                <td className="td" dir="ltr">{c.phone ?? "—"}</td><td className="td">{c.city ?? "—"}</td>
                <td className="td">{c.category ? <Badge>{c.category}</Badge> : "—"}</td>
                <td className="td tabular-nums">{c._count.orders}</td><td className="td">{date(c.orders[0]?.createdAt)}</td>
              </tr>))}</tbody>
          </table>
          </ResponsiveTable>
        ) : <Empty title={searchParams.q ? "لا نتائج مطابقة" : "لا يوجد عملاء بعد"} hint="أضف أول عميل لبدء إنشاء الطلبات وعروض الأسعار." />}
        <Pager page={page} total={total} base={`/customers?q=${encodeURIComponent(searchParams.q ?? "")}`} />
      </Card>
    </>
  );
}

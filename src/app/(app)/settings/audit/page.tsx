import { requireActor, pagePerm } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Pager, TableScroll } from "@/components/ui";
import { dateTime } from "@/lib/format";

export default async function Audit({ searchParams }: { searchParams: { action?: string; page?: string } }) {
  const a = await requireActor(); pagePerm(a, "audit.view");
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const where = searchParams.action ? { action: { contains: searchParams.action.toUpperCase() } } : {};
  const [rows, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { actor: { select: { fullName: true } } } }), db.auditLog.count({ where })]);
  return (
    <>
      <PageHeader title="سجل التدقيق" subtitle="سجل إلحاقي — لا يمكن تعديله أو حذفه من داخل النظام" />
      <Card>
        <form className="mb-3 flex flex-col gap-2 sm:flex-row"><input name="action" defaultValue={searchParams.action} className="input sm:w-64" aria-label="نوع العملية" placeholder="نوع العملية: LOGIN, ORDER_MONEY, ORDER_STATUS…" dir="ltr" /><button className="btn-ghost">تصفية</button></form>
        <TableScroll><table className="w-full text-sm"><thead><tr className="border-b border-paper-line"><th className="th">الوقت</th><th className="th">المستخدم</th><th className="th">العملية</th><th className="th">الكيان</th><th className="th">التفاصيل</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-paper-line/60 align-top"><td className="td whitespace-nowrap">{dateTime(r.createdAt)}</td><td className="td">{r.actor?.fullName ?? "—"}</td><td className="td font-mono text-xs" dir="ltr">{r.action}</td><td className="td text-xs" dir="ltr">{r.entity}</td><td className="td max-w-xl truncate font-mono text-xs" dir="ltr" title={JSON.stringify(r.after)}>{r.after ? JSON.stringify(r.after) : ""}</td></tr>)}</tbody></table></TableScroll>
        <Pager page={page} total={total} perPage={50} base={`/settings/audit?action=${searchParams.action ?? ""}`} />
      </Card>
    </>
  );
}

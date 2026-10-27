import Link from "next/link";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Pager, Progress, ResponsiveTable } from "@/components/ui";
import { FilterPanel } from "@/components/client";
import { OrderBadge, PriorityBadge, LateBadge } from "@/components/status";
import { orderScope, orderMoneyView } from "@/lib/order-access";
import { ORDER_STATUS, PRIORITY } from "@/lib/labels";
import { KANBAN_COLUMNS, FINISHED, isLate, progressOf } from "@/lib/order-flow";
import { money, date } from "@/lib/format";
import { Kanban } from "./kanban";
import type { OrderStatus, Priority } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

const GROUPS: Record<string, OrderStatus[]> = Object.fromEntries([...KANBAN_COLUMNS.map((c) => [c.key, c.statuses]), ["done", ["DELIVERED", "CLOSED"]]]);

export default async function Orders({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const a = await requireActor(); pagePerm(a, "orders.view");
  const view = sp.view === "kanban" ? "kanban" : "table";
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: Prisma.OrderWhereInput = { ...orderScope(a) };
  if (sp.status) where.status = sp.status as OrderStatus;
  else if (sp.group && GROUPS[sp.group]) where.status = { in: GROUPS[sp.group] };
  else if (view === "kanban") where.status = { notIn: ["CLOSED", "CANCELLED"] };
  if (sp.late) Object.assign(where, { dueDate: { lt: new Date() }, status: { notIn: FINISHED } });
  if (sp.priority) where.priority = sp.priority as Priority;
  if (sp.q) where.OR = [{ number: { contains: sp.q, mode: "insensitive" } }, { customer: { name: { contains: sp.q, mode: "insensitive" } } }];
  const sort = sp.sort === "due" ? { dueDate: "asc" as const } : sp.sort === "priority" ? { priority: "desc" as const } : { createdAt: "desc" as const };
  const take = view === "kanban" ? 300 : 25;
  const [rows, total] = await Promise.all([
    db.order.findMany({
      where, orderBy: sort, skip: view === "kanban" ? 0 : (page - 1) * 25, take,
      select: { id: true, number: true, status: true, priority: true, dueDate: true, total: true, paidAmount: true, version: true,
        customer: { select: { name: true } }, salesRep: { select: { fullName: true } }, _count: { select: { items: true } } },
    }),
    db.order.count({ where }),
  ]);
  const fin = can(a, "orders.view_value");
  const qs = (extra: Record<string, string>) => "/orders?" + new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="الطلبات" subtitle={`${total} طلب`} actions={<>
        <Link href={qs({ view: "table", page: "" })} className={view === "table" ? "btn-primary" : "btn-ghost"}>جدول</Link>
        <Link href={qs({ view: "kanban", page: "" })} className={view === "kanban" ? "btn-primary" : "btn-ghost"}>كانبان</Link>
        {can(a, "orders.create") && <Link href="/orders/new" className="btn-primary">طلب جديد</Link>}
      </>} />
      <Card>
        <FilterPanel active={[sp.q, sp.status, sp.priority, sp.sort, sp.late].filter(Boolean).length}>
          <form className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <input type="hidden" name="view" value={view} />
            <input name="q" defaultValue={sp.q} className="input sm:w-64" placeholder="رقم الطلب أو اسم العميل" aria-label="بحث في الطلبات" />
            <select name="status" defaultValue={sp.status ?? ""} className="input sm:w-48" aria-label="الحالة"><option value="">كل الحالات</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="priority" defaultValue={sp.priority ?? ""} className="input sm:w-36" aria-label="الأولوية"><option value="">كل الأولويات</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="sort" defaultValue={sp.sort ?? ""} className="input sm:w-40" aria-label="الترتيب"><option value="">الأحدث</option><option value="due">أقرب موعد تسليم</option><option value="priority">الأولوية</option></select>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="late" value="1" defaultChecked={!!sp.late} /> المتأخرة فقط</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2 sm:flex"><button className="btn-ghost">تطبيق</button><Link href="/orders" className="btn-ghost">مسح</Link></div>
          </form>
        </FilterPanel>
        {view === "kanban" ? (
          <Kanban columns={KANBAN_COLUMNS} orders={rows.map((o) => ({ id: o.id, number: o.number, status: o.status, customer: o.customer.name, priority: o.priority, due: o.dueDate.toISOString(), dueLabel: date(o.dueDate), late: isLate(o.dueDate, o.status), version: o.version }))} />
        ) : rows.length ? (
          <ResponsiveTable minWidth={760} cards={rows.map((o) => {
            const m = fin ? orderMoneyView(a, o) : null;
            return {
              key: o.id, href: `/orders/${o.id}`, title: <span className="tabular-nums">{o.number}</span>,
              badge: <><OrderBadge s={o.status} />{isLate(o.dueDate, o.status) && <LateBadge />}</>,
              lines: [o.customer.name, <span key="r" className="flex flex-wrap items-center gap-2">{o.salesRep.fullName} · <PriorityBadge p={o.priority} /></span>, `التسليم ${date(o.dueDate)}`,
                ...(m ? [`القيمة ${money(m.total)} — المتبقي ${money(m.remaining)}`] : [])],
            };
          })}>
          <table className="w-full">
            <thead><tr className="border-b border-paper-line"><th className="th">رقم الطلب</th><th className="th">العميل</th><th className="th">الحالة</th><th className="th">المسؤول</th><th className="th">الأولوية</th><th className="th">التسليم</th><th className="th">الإنجاز</th>{fin && <th className="th">القيمة</th>}{fin && <th className="th">المتبقي</th>}</tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id} className="border-b border-paper-line/60 hover:bg-paper">
                <td className="td"><Link href={`/orders/${o.id}`} className="font-medium text-cyan-deep tabular-nums">{o.number}</Link></td>
                <td className="td">{o.customer.name}</td>
                <td className="td"><span className="flex gap-1"><OrderBadge s={o.status} />{isLate(o.dueDate, o.status) && <LateBadge />}</span></td>
                <td className="td">{o.salesRep.fullName}</td><td className="td"><PriorityBadge p={o.priority} /></td>
                <td className="td">{date(o.dueDate)}</td><td className="td"><Progress value={progressOf(o.status)} /></td>
                {fin && (() => { const m = orderMoneyView(a, o)!; return <><td className="td tabular-nums">{money(m.total)}</td><td className="td tabular-nums">{money(m.remaining)}</td></>; })()}
              </tr>))}</tbody>
          </table>
          </ResponsiveTable>
        ) : <Empty title="لا توجد طلبات مطابقة" />}
        {view === "table" && <Pager page={page} total={total} base={qs({ page: "" })} />}
      </Card>
    </>
  );
}

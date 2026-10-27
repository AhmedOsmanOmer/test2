import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth";
import { can } from "@/server/actor";
import { getDashboard, periodRange, type Period } from "@/server/services/dashboard";
import { Card, PageHeader, Stat, Empty, Badge, TableScroll } from "@/components/ui";
import { OrderBadge, MachineBadge } from "@/components/status";
import { StatusChart, MonthlyChart, PeopleChart } from "@/components/charts/dashboard-charts";
import { ORDER_STATUS } from "@/lib/labels";
import { money, n, date } from "@/lib/format";

const PERIODS: [Period, string][] = [["today", "اليوم"], ["week", "الأسبوع"], ["month", "الشهر"], ["year", "السنة"]];

export default async function Dashboard({ searchParams }: { searchParams: { p?: Period; from?: string; to?: string } }) {
  const a = await requireActor();
  if (!can(a, "dashboard.view")) redirect("/my");
  const p = searchParams.p ?? "month";
  const d = await getDashboard(a, periodRange(p, searchParams.from, searchParams.to));
  const k = d.kpis;
  return (
    <>
      <PageHeader title="لوحة التحكم" subtitle={`مرحبًا ${a.fullName}`}
        actions={
          <form className="flex flex-wrap items-center gap-1">
            {PERIODS.map(([key, label]) => (
              <Link key={key} href={`/?p=${key}`} className={key === p ? "btn-primary" : "btn-ghost"}>{label}</Link>
            ))}
            <input type="hidden" name="p" value="custom" />
            <input type="date" name="from" defaultValue={searchParams.from} className="input w-[calc(50%-0.25rem)] sm:w-36" aria-label="من" />
            <input type="date" name="to" defaultValue={searchParams.to} className="input w-[calc(50%-0.25rem)] sm:w-36" aria-label="إلى" />
            <button className="btn-ghost">تطبيق</button>
          </form>
        } />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="إجمالي الطلبات" value={n(k.total)} href="/orders" />
        <Stat label="طلبات جديدة" value={n(k.newOrders)} href="/orders?group=intake" />
        <Stat label="بانتظار الدفعة" value={n(k.awaitingDeposit)} href="/orders?status=AWAITING_DEPOSIT" tone="yellow" />
        <Stat label="تحت التصميم" value={n(k.inDesign)} href="/orders?group=design" />
        <Stat label="بانتظار اعتماد العميل" value={n(k.awaitingApproval)} href="/orders?status=AWAITING_DESIGN_APPROVAL" tone="yellow" />
        <Stat label="تحت الإنتاج" value={n(k.inProduction)} href="/orders?group=production" />
        <Stat label="متأخرة" value={n(k.late)} href="/orders?late=1" tone="red" />
        <Stat label="جاهزة للتسليم" value={n(k.ready)} href="/orders?group=delivery" tone="green" />
        <Stat label="مكتملة" value={n(k.completed)} href="/orders?group=done" tone="green" />
        <Stat label="ملغاة" value={n(k.cancelled)} href="/orders?status=CANCELLED" tone="red" />
        <Stat label="متوسط مدة التنفيذ" value={`${n(k.avgLeadDays)} يوم`} />
        <Stat label="الالتزام بالمواعيد" value={k.onTimePct === null ? "—" : `${k.onTimePct}%`} tone="green" />
      </div>

      {d.money && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
          <Stat label="قيمة الطلبات (المنشأة خلال الفترة، دون الملغاة)" value={money(d.money.ordersValue)} />
          <Stat label="المتبقي الإجمالي (كل الطلبات غير الملغاة)" value={money(d.money.outstanding)} tone="yellow" />
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        <Card title="الطلبات حسب الحالة (اضغط للانتقال)">
          {d.byStatus.length ? <StatusChart data={d.byStatus.map((b) => ({ ...b, label: ORDER_STATUS[b.status] }))} /> : <Empty title="لا توجد طلبات بعد" />}
        </Card>
        <Card title="عدد الطلبات الشهري"><MonthlyChart data={d.monthly} /></Card>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card title="الطلبات المتأخرة" className="sm:col-span-2 lg:col-span-2" actions={<Link href="/orders?late=1" className="text-sm text-cyan-deep">عرض الكل</Link>}>
          {d.recentLate.length ? (
            <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">الطلب</th><th className="th">العميل</th><th className="th">المرحلة</th><th className="th">الموعد</th><th className="th">المسؤول</th><th className="th">سبب التأخير</th></tr></thead>
              <tbody>{d.recentLate.map((o) => (
                <tr key={o.id} className="border-b border-paper-line/60 last:border-0">
                  <td className="td"><Link href={`/orders/${o.id}`} className="font-medium text-cyan-deep">{o.number}</Link></td>
                  <td className="td">{o.customer.name}</td><td className="td"><OrderBadge s={o.status} /></td>
                  <td className="td text-magenta-process">{date(o.dueDate)}</td><td className="td">{o.salesRep.fullName}</td><td className="td text-ink-soft">{o.delayReason ?? "—"}</td>
                </tr>))}</tbody></table></TableScroll>
          ) : <Empty title="لا توجد طلبات متأخرة" />}
        </Card>
        <Card title="الطاقة التشغيلية — الآلات">
          <ul className="space-y-2">{d.capacity.map((m) => (
            <li key={m.name} className="flex items-center justify-between text-sm"><span>{m.name}</span><span className="flex items-center gap-2"><Badge>{m.jobs} أمر</Badge><MachineBadge s={m.status} /></span></li>
          ))}</ul>
        </Card>
      </div>
      <div className="mt-4"><Card title="أداء الموظفين خلال الفترة"><div className="table-scroll"><div className="min-w-[560px]"><PeopleChart data={d.people} /></div></div></Card></div>
    </>
  );
}

import Link from "next/link";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Progress, Badge, cx, TableScroll } from "@/components/ui";
import { ProdBadge, PriorityBadge, MachineBadge } from "@/components/status";
import { PRODUCTION_STATUS } from "@/lib/labels";
import { n, dateTime } from "@/lib/format";
import type { ProductionStatus } from "@/generated/prisma/enums";

const OPEN: ProductionStatus[] = ["PLANNED", "SCHEDULED", "IN_PROGRESS", "PAUSED", "QC_PENDING"];

export default async function Production({ searchParams }: { searchParams: { status?: string; view?: string; day?: string } }) {
  const a = await requireActor(); pagePerm(a, "production.view");
  const manager = can(a, "production.manage");
  const view = searchParams.view === "schedule" ? "schedule" : "list";
  const status = searchParams.status as ProductionStatus | undefined;
  const pos = await db.productionOrder.findMany({
    where: { ...(status ? { status } : { status: { in: OPEN } }), ...(manager ? {} : { OR: [{ assigneeId: a.id }, { stages: { some: { assigneeId: a.id } } }] }) },
    orderBy: [{ priority: "desc" }, { plannedStart: "asc" }, { createdAt: "asc" }], take: 300,
    include: { order: { select: { id: true, number: true, dueDate: true } }, orderItem: { select: { name: true } }, machine: { select: { id: true, name: true } }, assignee: { select: { fullName: true } }, stages: { where: { status: "IN_PROGRESS" }, select: { name: true } } },
  });
  const now = new Date();
  return (
    <>
      <PageHeader title="الإنتاج" subtitle={manager ? "كل أوامر التشغيل المفتوحة" : "أوامر التشغيل المسندة إليّ"} actions={<>
        <Link href="/production" className={view === "list" ? "btn-primary" : "btn-ghost"}>قائمة</Link>
        {manager && <Link href="/production?view=schedule" className={view === "schedule" ? "btn-primary" : "btn-ghost"}>جدولة الآلات</Link>}
        {manager && <Link href="/production/machines" className="btn-ghost">الآلات</Link>}
      </>} />
      {view === "schedule" && manager ? <Schedule day={searchParams.day} /> : (
        <Card>
          <form className="mb-3 flex flex-col gap-2 sm:flex-row"><select name="status" defaultValue={status ?? ""} className="input sm:w-56" aria-label="حالة أمر التشغيل"><option value="">المفتوحة</option>{Object.entries(PRODUCTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="btn-ghost">تصفية</button></form>
          {pos.length ? <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">الأمر</th><th className="th">الطلب</th><th className="th">المنتج</th><th className="th">الكمية</th><th className="th">المرحلة</th><th className="th">الآلة</th><th className="th">المسؤول</th><th className="th">الأولوية</th><th className="th">نهاية مخططة</th><th className="th">الإنجاز</th><th className="th">الحالة</th></tr></thead>
            <tbody>{pos.map((p) => { const late = (p.plannedEnd ?? p.order.dueDate) < now && ["IN_PROGRESS", "PAUSED", "SCHEDULED", "PLANNED"].includes(p.status); return (
              <tr key={p.id} className={cx("border-b border-paper-line/60 hover:bg-paper", late && "bg-rose-50/60")}>
                <td className="td"><Link href={`/production/${p.id}`} className="font-medium text-cyan-deep">{p.number}</Link>{p.parentId && <Badge tone="yellow">إعادة</Badge>}</td>
                <td className="td"><Link href={`/orders/${p.order.id}?tab=production`} className="text-cyan-deep">{p.order.number}</Link></td>
                <td className="td">{p.orderItem.name}</td><td className="td tabular-nums">{n(p.quantity)}</td><td className="td">{p.stages[0]?.name ?? "—"}</td>
                <td className="td">{p.machine?.name ?? "—"}</td><td className="td">{p.assignee?.fullName ?? "—"}</td><td className="td"><PriorityBadge p={p.priority} /></td>
                <td className={cx("td", late && "text-magenta-process")}>{dateTime(p.plannedEnd)}</td><td className="td"><Progress value={p.progressPct} /></td><td className="td"><ProdBadge s={p.status} /></td>
              </tr>); })}</tbody></table></TableScroll> : <Empty title="لا توجد أوامر تشغيل" hint="تُنشأ أوامر التشغيل من تبويب «الإنتاج» داخل الطلب بعد اعتماد التصميم." />}
        </Card>)}
    </>
  );
}

/** جدولة الآلات: شريط زمني لكل آلة ليوم محدد مع كشف التعارضات */
async function Schedule({ day }: { day?: string }) {
  const start = day ? new Date(day + "T00:00:00") : new Date(new Date().setHours(0, 0, 0, 0));
  const end = new Date(start.getTime() + 86400_000);
  const [machines, jobs] = await Promise.all([
    db.machine.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.productionOrder.findMany({
      where: { machineId: { not: null }, plannedStart: { lt: end }, plannedEnd: { gt: start }, status: { notIn: ["CANCELLED"] } },
      include: { order: { select: { number: true } }, orderItem: { select: { name: true } } },
    }),
  ]);
  const unscheduled = await db.productionOrder.count({ where: { status: { in: ["PLANNED"] } } });
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / 86400_000) * 100));
  const hours = Array.from({ length: 13 }, (_, i) => i * 2);
  const prev = new Date(start.getTime() - 86400_000).toISOString().slice(0, 10), next = new Date(start.getTime() + 86400_000).toISOString().slice(0, 10);
  return (
    <Card title={`جدول الآلات — ${start.toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "long", day: "numeric", month: "long" })}`}
      actions={<div className="flex flex-wrap gap-2"><Link className="btn-ghost" href={`/production?view=schedule&day=${prev}`}>اليوم السابق</Link><Link className="btn-ghost" href="/production?view=schedule">اليوم</Link><Link className="btn-ghost" href={`/production?view=schedule&day=${next}`}>اليوم التالي</Link></div>}>
      {unscheduled > 0 && <p className="mb-3 text-sm text-amber-700">{unscheduled} أمر تشغيل بدون موعد مخطط — حدد له آلة وموعدًا ليظهر في الجدول.</p>}
      {/* الجوال: قائمة أوامر اليوم لكل آلة؛ والخط الزمني من 640px داخل حاوية تمرير أفقي */}
      <ul className="space-y-3 sm:hidden">{machines.map((m) => {
        const mj = jobs.filter((j) => j.machineId === m.id).sort((x, y) => x.plannedStart!.getTime() - y.plannedStart!.getTime());
        return (
          <li key={m.id} className="rounded-md border border-paper-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{m.name}</span><MachineBadge s={m.status} /></div>
            {mj.length ? <ul className="mt-2 space-y-1 text-sm">{mj.map((j) => (
              <li key={j.id}><Link href={`/production/${j.id}`} className="text-cyan-deep">{j.number}</Link> — {j.order.number} — {j.orderItem.name}
                <div className="text-xs text-ink-soft">{j.plannedStart!.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })} ← {j.plannedEnd!.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</div></li>))}</ul>
              : <p className="mt-1 text-sm text-ink-soft">لا أوامر في هذا اليوم</p>}
          </li>);
      })}</ul>
      <div className="table-scroll hidden sm:block"><div className="min-w-[720px]">
      <div className="relative ms-48 mb-1 h-5 text-xs text-ink-faint">{hours.map((h) => <span key={h} className="absolute -translate-x-1/2" style={{ insetInlineStart: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}:00</span>)}</div>
      <div className="space-y-2">{machines.map((m) => {
        const mj = jobs.filter((j) => j.machineId === m.id).sort((x, y) => x.plannedStart!.getTime() - y.plannedStart!.getTime());
        const clash = mj.some((j, i) => i > 0 && j.plannedStart! < mj[i - 1].plannedEnd!);
        return (
          <div key={m.id} className="flex items-center gap-2">
            <div className="w-46 w-[184px] shrink-0 text-sm"><div className="font-medium">{m.name}</div><div className="flex gap-1"><MachineBadge s={m.status} />{clash && <Badge tone="red">تعارض</Badge>}</div></div>
            <div className="relative h-11 flex-1 rounded bg-paper">
              {mj.map((j) => (
                <Link key={j.id} href={`/production/${j.id}`} title={`${j.number} — ${j.orderItem.name}`}
                  className={cx("absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-[11px] leading-tight text-white",
                    j.status === "IN_PROGRESS" ? "bg-emerald-600" : j.priority === "URGENT" ? "bg-magenta-process" : ["QC_PENDING", "QC_PASSED", "COMPLETED"].includes(j.status) ? "bg-slate-400" : "bg-sky-500")}
                  style={{ insetInlineStart: `${pct(j.plannedStart!)}%`, width: `${Math.max(2, pct(j.plannedEnd!) - pct(j.plannedStart!))}%` }}>
                  {j.order.number}<br />{j.orderItem.name}
                </Link>))}
              {m.status === "MAINTENANCE" && <div className="absolute inset-0 rounded bg-amber-200/40" />}
            </div>
          </div>);
      })}</div>
      </div></div>
      <p className="mt-3 text-xs text-ink-faint">أخضر: قيد التشغيل — أزرق: مجدول — أحمر: عاجل — رمادي: منتهٍ. يمنع النظام حجز آلة في فترة متداخلة عند إنشاء أمر التشغيل.</p>
    </Card>
  );
}

import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { MachineBadge } from "@/components/status";
import { ActionButton } from "@/components/client";
import { machineStatusAction } from "@/server/actions";
import { dateTime, n } from "@/lib/format";
import { MachineForm } from "./form";

export default async function Machines() {
  const a = await requireActor(); pagePerm(a, "production.view");
  const manage = can(a, "machines.manage");
  const [machines, staff] = await Promise.all([
    db.machine.findMany({ orderBy: { code: "asc" }, include: { responsible: { select: { fullName: true } }, maintenance: { orderBy: { startedAt: "desc" }, take: 5 }, _count: { select: { productionOrders: { where: { status: { in: ["IN_PROGRESS", "SCHEDULED"] } } } } } } }),
    manage ? db.user.findMany({ where: { isActive: true, department: "PRODUCTION" }, select: { id: true, fullName: true } }) : [],
  ]);
  return (
    <>
      <PageHeader title="الآلات والمعدات" subtitle="الحالة والطاقة وسجل الصيانة والأعطال" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        {machines.map((m) => (
          <Card key={m.id} title={`${m.code} — ${m.name}`} actions={<MachineBadge s={m.status} />}>
            <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
              {[["النوع", m.type], ["الطاقة", m.capacityPerHour ? `${n(m.capacityPerHour)} ${m.capacityUnit ?? ""}` : "—"], ["ساعات التشغيل", n(Number(m.runningHours))], ["أوامر حالية", String(m._count.productionOrders)], ["المسؤول", m.responsible?.fullName ?? "—"], ["على الشاشة", m.showOnBoard ? "نعم" : "لا"]].map(([k, v]) => <div key={k}><dt className="text-xs text-ink-soft">{k}</dt><dd>{v}</dd></div>)}
            </dl>
            {m.maintenance.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">{m.maintenance.map((x) => <li key={x.id}>{x.kind}: {x.description} — {dateTime(x.startedAt)}{x.endedAt ? ` ← ${dateTime(x.endedAt)}` : " (مستمر)"}</li>)}</ul>}
            {manage && <div className="mt-3 flex flex-wrap gap-2">
              {m.status !== "AVAILABLE" && m.status !== "RUNNING" && <ActionButton className="btn-primary" action={machineStatusAction.bind(null, m.id, "AVAILABLE")}>إعادة للخدمة</ActionButton>}
              {m.status !== "MAINTENANCE" && <ActionButton askReason="وصف الصيانة:" action={machineStatusAction.bind(null, m.id, "MAINTENANCE")}>تحويل للصيانة</ActionButton>}
              {m.status !== "STOPPED" && <ActionButton className="btn-danger" askReason="وصف العطل:" action={machineStatusAction.bind(null, m.id, "STOPPED")}>تسجيل عطل</ActionButton>}
            </div>}
          </Card>))}
      </div>
      {manage && <div className="mt-4"><Card title="إضافة آلة"><MachineForm staff={staff} /></Card></div>}
    </>
  );
}

import Link from "next/link";
import { requireActor } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Stat, Progress } from "@/components/ui";
import { DesignBadge, ProdBadge, PriorityBadge } from "@/components/status";
import { date } from "@/lib/format";

export default async function MyWork() {
  const a = await requireActor();
  const now = new Date(); const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59);
  const [designs, prods, tasks] = await Promise.all([
    db.designTask.findMany({ where: { assigneeId: a.id, status: { notIn: ["APPROVED", "CANCELLED"] } }, orderBy: [{ priority: "desc" }, { dueDate: "asc" }], include: { order: { select: { number: true } } } }),
    db.productionOrder.findMany({ where: { OR: [{ assigneeId: a.id }, { stages: { some: { assigneeId: a.id } } }], status: { in: ["PLANNED", "SCHEDULED", "IN_PROGRESS", "PAUSED"] } }, orderBy: [{ priority: "desc" }, { plannedStart: "asc" }], include: { order: { select: { number: true } }, orderItem: { select: { name: true } } } }),
    db.task.findMany({ where: { assigneeId: a.id, status: { in: ["NEW", "IN_PROGRESS", "BLOCKED"] } }, orderBy: [{ priority: "desc" }, { dueDate: "asc" }], include: { order: { select: { id: true, number: true } } } }),
  ]);
  const late = designs.filter((d) => d.dueDate && d.dueDate < now).length + prods.filter((p) => p.plannedEnd && p.plannedEnd < now).length + tasks.filter((t) => t.dueDate && t.dueDate < now).length;
  const today = designs.filter((d) => d.dueDate && d.dueDate <= endOfDay).length + prods.filter((p) => p.plannedStart && p.plannedStart <= endOfDay).length + tasks.filter((t) => t.dueDate && t.dueDate <= endOfDay).length;
  return (
    <>
      <PageHeader title="مهامي" subtitle={a.fullName} />
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="مهام اليوم" value={today} /><Stat label="متأخرة" value={late} tone="red" />
        <Stat label="قيد التنفيذ" value={prods.filter((p) => p.status === "IN_PROGRESS").length + designs.filter((d) => d.status === "IN_PROGRESS").length} tone="yellow" />
        <Stat label="إجمالي المفتوح" value={designs.length + prods.length + tasks.length} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card title="أوامر التشغيل">{prods.length ? <ul className="divide-y divide-paper-line">{prods.map((p) => <li key={p.id} className="py-2 text-sm"><Link className="font-medium text-cyan-deep" href={`/production/${p.id}`}>{p.number}</Link> — {p.order.number} — {p.orderItem.name}<div className="mt-1 flex items-center justify-between"><ProdBadge s={p.status} /><Progress value={p.progressPct} /></div></li>)}</ul> : <Empty title="لا أوامر تشغيل" />}</Card>
        <Card title="مهام التصميم">{designs.length ? <ul className="divide-y divide-paper-line">{designs.map((d) => <li key={d.id} className="py-2 text-sm"><Link className="font-medium text-cyan-deep" href={`/design/${d.id}`}>{d.number}</Link> — {d.order.number}<div className="mt-1 flex justify-between"><DesignBadge s={d.status} /><span className={d.dueDate && d.dueDate < now ? "text-magenta-process" : "text-ink-soft"}>{date(d.dueDate)}</span></div></li>)}</ul> : <Empty title="لا مهام تصميم" />}</Card>
        <Card title="مهام عامة وتصحيحية">{tasks.length ? <ul className="divide-y divide-paper-line">{tasks.map((t) => <li key={t.id} className="py-2 text-sm"><b>{t.number}</b> — {t.title}{t.order && <> — <Link className="text-cyan-deep" href={`/orders/${t.order.id}`}>{t.order.number}</Link></>}<div className="mt-1 flex justify-between"><PriorityBadge p={t.priority} /><span className="text-ink-soft">{date(t.dueDate)}</span></div>{t.description && <p className="text-xs text-ink-soft">{t.description}</p>}</li>)}</ul> : <Empty title="لا مهام" />}</Card>
      </div>
    </>
  );
}

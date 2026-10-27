import Link from "next/link";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Stat } from "@/components/ui";
import { DesignBadge, PriorityBadge } from "@/components/status";
import { date } from "@/lib/format";

export default async function DesignBoard() {
  const a = await requireActor(); pagePerm(a, "design.view");
  // المصمم يرى مهامه فقط؛ من يملك صلاحية الإسناد يرى الجميع
  const where = can(a, "design.assign") ? { status: { not: "CANCELLED" as const } } : { assigneeId: a.id, status: { not: "CANCELLED" as const } };
  const tasks = await db.designTask.findMany({
    where,
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    include: { order: { select: { number: true, customer: { select: { name: true } } } }, orderItem: { select: { name: true, length: true, width: true } }, assignee: { select: { fullName: true } } },
  });
  const now = new Date();
  const lateT = tasks.filter((t) => t.status !== "APPROVED" && t.dueDate && t.dueDate < now);
  const groups: [string, typeof tasks][] = [
    ["مهام جديدة", tasks.filter((t) => t.status === "PENDING")],
    ["قيد العمل / تعديلات مطلوبة", tasks.filter((t) => ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(t.status))],
    ["بانتظار المراجعة أو العميل", tasks.filter((t) => ["INTERNAL_REVIEW", "SENT_TO_CUSTOMER"].includes(t.status))],
    ["منجزة ومعتمدة", tasks.filter((t) => t.status === "APPROVED").slice(0, 20)],
  ];
  return (
    <>
      <PageHeader title="التصميم" subtitle={can(a, "design.assign") ? "جميع مهام التصميم" : "مهامي"} />
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="جديدة" value={groups[0][1].length} /><Stat label="قيد العمل" value={groups[1][1].length} tone="yellow" />
        <Stat label="متأخرة" value={lateT.length} tone="red" /><Stat label="معتمدة" value={tasks.filter((t) => t.status === "APPROVED").length} tone="green" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        {groups.map(([title, list]) => (
          <Card key={title} title={`${title} (${list.length})`}>
            {list.length ? <ul className="divide-y divide-paper-line">{list.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div><Link href={`/design/${t.id}`} className="font-medium text-cyan-deep">{t.number}</Link> — {t.order.number} — {t.order.customer.name}
                  <div className="text-xs text-ink-soft">{t.orderItem?.name ?? "كل المنتجات"} — {t.assignee?.fullName ?? "غير مسند"} — الموعد <span className={t.dueDate && t.dueDate < now && t.status !== "APPROVED" ? "text-magenta-process" : ""}>{date(t.dueDate)}</span> — تعديلات {t.revisionCount}</div></div>
                <span className="flex gap-1"><PriorityBadge p={t.priority} /><DesignBadge s={t.status} /></span>
              </li>))}</ul> : <Empty title="لا توجد مهام" />}
          </Card>))}
      </div>
    </>
  );
}

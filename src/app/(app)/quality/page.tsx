import Link from "next/link";
import { requireActor, pagePerm } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Badge } from "@/components/ui";
import { n, dateTime } from "@/lib/format";
import { InspectForm } from "./form";

export default async function Quality() {
  const a = await requireActor(); pagePerm(a, "quality.inspect");
  const [pending, recent, reasons] = await Promise.all([
    db.productionOrder.findMany({ where: { status: "QC_PENDING" }, orderBy: { actualEnd: "asc" }, include: { order: { select: { id: true, number: true } }, orderItem: { select: { name: true, length: true, width: true, colors: true, material: true } }, assignee: { select: { fullName: true } } } }),
    db.qualityInspection.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { productionOrder: { select: { number: true, orderItem: { select: { name: true } } } }, inspector: { select: { fullName: true } } } }),
    db.qualityInspection.groupBy({ by: ["rejectReason"], where: { result: { in: ["REJECTED", "REWORK"] }, createdAt: { gte: new Date(Date.now() - 90 * 86400_000) } }, _count: true, _sum: { rejectedQty: true } }),
  ]);
  const scrap = await db.productionLog.groupBy({ by: ["scrapReason"], where: { scrapQty: { gt: 0 }, createdAt: { gte: new Date(Date.now() - 90 * 86400_000) } }, _sum: { scrapQty: true }, _count: true });
  return (
    <>
      <PageHeader title="مراقبة الجودة" subtitle={`${pending.length} أمر تشغيل بانتظار الفحص`} />
      <div className="space-y-4">
        {pending.length ? pending.map((p) => (
          <Card key={p.id} title={<span>{p.number} — <Link className="text-cyan-deep" href={`/orders/${p.order.id}?tab=quality`}>{p.order.number}</Link> — {p.orderItem.name}</span>} actions={<span className="text-sm text-ink-soft">منتج {n(p.completedQty)} — أنهاه {p.assignee?.fullName ?? "—"} {dateTime(p.actualEnd)}</span>}>
            <p className="mb-3 text-sm text-ink-soft">المواصفات: {[p.orderItem.material, p.orderItem.colors, [p.orderItem.length, p.orderItem.width].filter(Boolean).map(Number).join("×")].filter(Boolean).join(" — ") || "—"}</p>
            <InspectForm id={p.id} produced={p.completedQty} />
          </Card>)) : <Card><Empty title="لا توجد منتجات بانتظار الفحص" /></Card>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card title="أسباب الرفض (90 يومًا)">{reasons.length ? <ul className="space-y-1 text-sm">{reasons.sort((x, y) => y._count - x._count).map((r) => <li key={r.rejectReason ?? "-"} className="flex justify-between"><span>{r.rejectReason ?? "غير محدد"}</span><span>{r._count} مرة — {n(r._sum.rejectedQty)} قطعة</span></li>)}</ul> : <Empty title="لا رفض" />}</Card>
          <Card title="الهدر في الإنتاج حسب السبب (90 يومًا)">{scrap.length ? <ul className="space-y-1 text-sm">{scrap.sort((x, y) => (y._sum.scrapQty ?? 0) - (x._sum.scrapQty ?? 0)).map((r) => <li key={r.scrapReason ?? "-"} className="flex justify-between"><span>{r.scrapReason ?? "غير محدد"}</span><span>{n(r._sum.scrapQty)} قطعة ({r._count} تسجيل)</span></li>)}</ul> : <Empty title="لا هدر" />}</Card>
          <Card title="آخر الفحوصات">{recent.length ? <ul className="space-y-1 text-sm">{recent.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>{r.productionOrder?.number} — {r.productionOrder?.orderItem.name}</span><Badge tone={r.result.startsWith("ACCEPTED") ? "green" : "red"}>{r.acceptedQty}/{r.inspectedQty}</Badge></li>)}</ul> : <Empty title="لا فحوصات" />}</Card>
        </div>
      </div>
    </>
  );
}

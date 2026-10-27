import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Progress, Badge } from "@/components/ui";
import { ProdBadge, PriorityBadge } from "@/components/status";
import { ActionButton } from "@/components/client";
import { startProductionAction, pauseProductionAction, completeStageAction, completeProductionAction } from "@/server/actions";
import { n, dateTime } from "@/lib/format";
import { PRODUCTION_STATUS } from "@/lib/labels";
import { inOrderScope } from "@/lib/order-access";
import { ProgressForm } from "./widgets";

export default async function ProductionOrderPage({ params }: { params: { id: string } }) {
  const a = await requireActor(); pagePerm(a, "production.view");
  const p = await db.productionOrder.findUnique({
    where: { id: params.id },
    include: {
      order: { select: { id: true, number: true, dueDate: true, salesRepId: true, customer: { select: { name: true } } } },
      orderItem: true, machine: true, assignee: { select: { id: true, fullName: true } }, parent: { select: { id: true, number: true } }, reworks: { select: { id: true, number: true, status: true } },
      stages: { orderBy: { sequence: "asc" }, include: { assignee: { select: { fullName: true } } } },
      logs: { orderBy: { createdAt: "desc" }, include: { user: { select: { fullName: true } } } },
      inspections: { include: { inspector: { select: { fullName: true } } } },
    },
  });
  if (!p) notFound();
  const mine = p.assigneeId === a.id || p.stages.some((s) => s.assigneeId === a.id);
  const operate = can(a, "production.manage") || (can(a, "production.work") && mine);
  if (!can(a, "production.manage") && !mine && !(can(a, "orders.view") && inOrderScope(a, p.order))) notFound();
  const i = p.orderItem;
  const qr = await QRCode.toDataURL(`${process.env.APP_URL ?? ""}/production/${p.id}`, { margin: 1, width: 132 });
  const designFiles = await db.attachment.findMany({ where: { designVersion: { approvedFor: { orderId: p.orderId, OR: [{ orderItemId: p.orderItemId }, { orderItemId: null }] } } }, select: { id: true, originalName: true } });
  const current = p.stages.find((s) => s.status === "IN_PROGRESS");
  return (
    <>
      <PageHeader title={`أمر التشغيل ${p.number}`}
        subtitle={<span className="flex items-center gap-2"><ProdBadge s={p.status} /><PriorityBadge p={p.priority} />{p.parent && <Badge tone="yellow">إعادة إنتاج لـ {p.parent.number}</Badge>}<Link className="text-cyan-deep" href={`/orders/${p.order.id}?tab=production`}>{p.order.number}</Link> — {p.order.customer.name}</span>}
        actions={<Link href="/production" className="btn-ghost">رجوع</Link>} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <Card title="المواصفات">
            <dl className="grid grid-cols-2 gap-2 text-sm wrap-anywhere">
              {[["المنتج", i.name], ["الكمية المطلوبة", n(p.quantity)], ["الدفعة", String(p.batchNo)], ["المقاس", [i.length, i.width, i.height].filter(Boolean).map(Number).join(" × ") || "—"], ["الخامة", i.material], ["السماكة", i.materialThickness], ["الطباعة", i.printType], ["الألوان", i.colors], ["التشطيب", i.finishing], ["التغليف", i.packaging], ["الآلة", p.machine?.name], ["المسؤول", p.assignee?.fullName], ["البداية المخططة", dateTime(p.plannedStart)], ["النهاية المخططة", dateTime(p.plannedEnd)], ["البداية الفعلية", dateTime(p.actualStart)], ["النهاية الفعلية", dateTime(p.actualEnd)]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-ink-soft">{k}</dt><dd>{v || "—"}</dd></div>)}
            </dl>
            {i.technicalNotes && <p className="mt-2 rounded bg-paper p-2 text-sm">{i.technicalNotes}</p>}
            {p.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{p.notes}</p>}
          </Card>
          <Card title="ملفات التصميم المعتمدة">{designFiles.length ? <ul className="text-sm">{designFiles.map((f) => <li key={f.id}><a className="text-cyan-deep" href={`/api/files/${f.id}`}>{f.originalName}</a></li>)}</ul> : <Empty title="لا يوجد تصميم معتمد مرتبط" />}</Card>
          <Card title="رمز QR"><div className="flex items-center gap-3"><img src={qr} alt="QR" width={110} height={110} /><p className="text-xs text-ink-soft">امسحه بقارئ QR متصل بالكمبيوتر لفتح هذه الصفحة (يتطلب تسجيل الدخول).</p></div></Card>
        </div>

        <div className="sm:col-span-2 lg:col-span-2 space-y-4">
          <Card title="التقدم">
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold tabular-nums">{n(p.completedQty)} <span className="text-base font-normal text-ink-soft">/ {n(p.quantity)} منجز — تالف {n(p.scrapQty)}</span></div>
              <Progress value={p.progressPct} />
            </div>
            {operate && <div className="mt-4 flex flex-wrap gap-2">
              {["PLANNED", "SCHEDULED", "PAUSED"].includes(p.status) && <ActionButton className="btn-primary" action={startProductionAction.bind(null, p.id)}>{p.status === "PAUSED" ? "استئناف الإنتاج" : "بدء الإنتاج"}</ActionButton>}
              {p.status === "IN_PROGRESS" && current && <ActionButton className="btn-primary" action={completeStageAction.bind(null, p.id, current.id)}>إنهاء مرحلة «{current.name}»</ActionButton>}
              {p.status === "IN_PROGRESS" && <ActionButton askReason="سبب الإيقاف المؤقت:" action={pauseProductionAction.bind(null, p.id)}>إيقاف مؤقت</ActionButton>}
              {p.status === "IN_PROGRESS" && <ActionButton className="btn-danger" confirm="إنهاء أمر التشغيل وإرساله لفحص الجودة؟" action={completeProductionAction.bind(null, p.id)}>إنهاء الإنتاج وإرسال للجودة</ActionButton>}
            </div>}
          </Card>
          <Card title="مراحل التشغيل">
            <ol className="flex flex-wrap gap-2">{p.stages.map((s) => (
              <li key={s.id} className={`rounded border px-3 py-2 text-sm ${s.status === "DONE" ? "border-emerald-300 bg-emerald-50" : s.status === "IN_PROGRESS" ? "border-cyan-process bg-sky-50 font-semibold" : "border-paper-line"}`}>
                {s.sequence}. {s.name}<div className="text-xs font-normal text-ink-soft">{s.status === "DONE" ? `انتهت ${dateTime(s.completedAt)}` : s.status === "IN_PROGRESS" ? `بدأت ${dateTime(s.startedAt)}` : "بانتظار"}</div>
              </li>))}</ol>
          </Card>
          {operate && p.status === "IN_PROGRESS" && <Card title="تسجيل الكمية المنجزة والتالفة"><ProgressForm id={p.id} remaining={p.quantity - p.completedQty} /></Card>}
          <div>
            <Card title="سجل الإنتاج">{p.logs.length ? <ul className="space-y-1 text-sm">{p.logs.map((l) => <li key={l.id}>{dateTime(l.createdAt)} — {l.user.fullName}: منجز {n(l.goodQty)}{l.scrapQty ? `، تالف ${n(l.scrapQty)} (${l.scrapReason})` : ""}{l.note ? ` — ${l.note}` : ""}</li>)}</ul> : <Empty title="لم يُسجل إنتاج بعد" />}</Card>
          </div>
          {(p.inspections.length > 0 || p.reworks.length > 0) && <Card title="الجودة وإعادة الإنتاج">
            <ul className="space-y-1 text-sm">{p.inspections.map((x) => <li key={x.id}>{dateTime(x.createdAt)} — {x.inspector.fullName}: مقبول {x.acceptedQty}، مرفوض {x.rejectedQty} {x.rejectReason ? `— ${x.rejectReason}` : ""}</li>)}
              {p.reworks.map((r) => <li key={r.id}>أمر إعادة إنتاج: <Link className="text-cyan-deep" href={`/production/${r.id}`}>{r.number}</Link> ({PRODUCTION_STATUS[r.status]})</li>)}</ul>
          </Card>}
        </div>
      </div>
    </>
  );
}

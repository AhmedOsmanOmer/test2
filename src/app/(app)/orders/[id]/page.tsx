import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { inOrderScope, orderMoneyView } from "@/lib/order-access";
import { Card, PageHeader, Empty, Badge, Progress, cx, TableScroll } from "@/components/ui";
import { OrderBadge, PriorityBadge, ProdBadge, DesignBadge, LateBadge, ItemBadge } from "@/components/status";
import { ActionButton, ScrollActiveIntoView } from "@/components/client";
import { cancelItemQtyPromptAction, deleteDeliveryProofAction } from "@/server/actions";
import { ProofGallery } from "@/components/proof-gallery";
import { isLate, progressOf } from "@/lib/order-flow";
import { money, n, date, dateTime, riyadhYmd } from "@/lib/format";
import { DELIVERY_METHOD, ATTACHMENT_KIND, QC_RESULT } from "@/lib/labels";
import { ImportItems } from "@/components/import-items";
import { canAddItems, ADD_ITEMS_BLOCKED_MSG } from "@/server/services/item-import";
import { StatusControl, DueDateForm, ReassignRepForm, MoneyForm, DepositToggle, AssignDesign, CreateProduction, DeliveryForm, CommentBox, FileUpload } from "./widgets";

const TABS = [
  ["overview", "نظرة عامة"], ["items", "المنتجات والمواصفات"], ["design", "التصميم"], ["production", "الإنتاج"], ["quality", "الجودة"],
  ["delivery", "التسليم"], ["files", "الملفات"], ["comments", "التعليقات"], ["timeline", "السجل الزمني"],
] as const;

export default async function OrderPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; dn?: string } }) {
  const a = await requireActor(); pagePerm(a, "orders.view");
  const tab = searchParams.tab ?? "overview";
  const o = await db.order.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, name: true, code: true, address: true, city: true } }, salesRep: { select: { fullName: true } }, createdBy: { select: { fullName: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { category: true } },
      designTasks: { include: { assignee: { select: { fullName: true } }, orderItem: { select: { name: true } }, versions: { orderBy: { versionNo: "desc" } }, approvals: { orderBy: { createdAt: "desc" }, include: { recordedBy: { select: { fullName: true } } } } } },
      productionOrders: { orderBy: { createdAt: "asc" }, include: { orderItem: { select: { name: true } }, machine: { select: { name: true } }, assignee: { select: { fullName: true } }, stages: { orderBy: { sequence: "asc" } }, inspections: { include: { inspector: { select: { fullName: true } } } } } },
      deliveries: { orderBy: { createdAt: "asc" }, include: { items: { include: { orderItem: { select: { name: true } } } }, handler: { select: { fullName: true } },
        proofs: { where: { kind: "DELIVERY_PROOF" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, uploadedBy: { select: { fullName: true } } } } } },
      attachments: { orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { fullName: true } } } },
      comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { fullName: true } } } },
      events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { fullName: true } } } },
    },
  });
  // خارج نطاق المستخدم = غير موجود
  if (!o || !inOrderScope(a, o)) notFound();
  const m = orderMoneyView(a, o);
  const late = isLate(o.dueDate, o.status);
  // إثبات التسليم: لكل سند تسليم صوره، ومن سلّم ومتى (بتوقيت الرياض)
  const withProofs = o.deliveries.filter((d) => d.proofs.length);
  const isAdmin = a.roles.includes("SUPER_ADMIN");
  const proofSection = withProofs.length ? (
    <Card title={`إثبات التسليم (${withProofs.reduce((n, d) => n + d.proofs.length, 0)} صورة)`}>
      <div className="space-y-4" data-testid="delivery-proofs">{withProofs.map((d) => (
        <div key={d.id}>
          <p className="mb-2 text-sm"><b>{d.number}</b> {d.isFinal ? <Badge tone="green">نهائي</Badge> : <Badge tone="yellow">جزئي</Badge>} — سلّمه {d.proofs[0].uploadedBy.fullName} — {dateTime(d.proofs[0].createdAt)} — المستلم {d.recipientName}</p>
          <ProofGallery photos={d.proofs.map((p, i) => ({ id: p.id, alt: `صورة إثبات ${i + 1} للسند ${d.number}`, caption: `${d.number} — ${dateTime(p.createdAt)}` }))} />
          {isAdmin && <div className="mt-2 flex flex-wrap gap-2">{d.proofs.map((p, i) => (
            <ActionButton key={p.id} className="btn-ghost text-xs text-magenta-process" askReason={`سبب حذف صورة الإثبات ${i + 1} (يُسجَّل في التدقيق):`} action={deleteDeliveryProofAction.bind(null, o.id, p.id)}>حذف الصورة {i + 1}</ActionButton>))}</div>}
        </div>))}</div>
    </Card>
  ) : null;
  const qr = await QRCode.toDataURL(`${process.env.APP_URL ?? ""}/orders/${o.id}`, { margin: 1, width: 132 });

  const tabBody = await (async () => {
    switch (tab) {
      case "items": return (<div className="space-y-4">
        {can(a, "orders.import_items") && <Card title="استيراد بنود من Excel">
          {await canAddItems(o.id) ? <ImportItems orderId={o.id} /> : <p className="text-sm text-ink-soft">{ADD_ITEMS_BLOCKED_MSG}</p>}
        </Card>}
        <Card>{o.items.map((i) => (
          <div key={i.id} className="border-b border-paper-line py-3 last:border-0">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold wrap-anywhere">{i.name} <span className="text-ink-soft">× {n(i.quantity)} {i.unit}</span></h3><ItemBadge s={i.status} /></div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              {[["التصنيف", i.category?.name], ["المقاس", [i.length, i.width, i.height].filter(Boolean).map(Number).join(" × ") + (i.length ? ` ${i.dimensionUnit}` : "")], ["الخامة", i.material], ["السماكة", i.materialThickness], ["الطباعة", i.printType], ["الألوان", i.colors], ["التشطيب", i.finishing], ["التغليف", i.packaging],
                ["المنتج", n(i.producedQty)], ["المعتمد بالجودة", n(i.approvedQty)], ["المسلّم", n(i.deliveredQty)], ["الملغى", n(i.cancelledQty)]].map(([k, v]) => (
                <div key={k as string}><dt className="text-xs text-ink-soft">{k}</dt><dd>{v || "—"}</dd></div>))}
            </dl>
            {i.description && <p className="mt-2 text-sm">{i.description}</p>}
            {i.technicalNotes && <p className="mt-1 text-sm text-ink-soft">ملاحظات فنية: {i.technicalNotes}</p>}
            {can(a, "orders.cancel") && i.quantity - i.deliveredQty - i.cancelledQty > 0 && !["CLOSED", "CANCELLED"].includes(o.status) && (
              <div className="mt-2"><ActionButton askReason={`إلغاء جزئي — اكتب "الكمية: السبب" (المتاح ${i.quantity - i.deliveredQty - i.cancelledQty})`}
                action={cancelItemQtyPromptAction.bind(null, o.id, i.id)}>إلغاء جزئي للكمية</ActionButton></div>)}
          </div>))}</Card>
      </div>);

      case "design": {
        const designers = can(a, "design.assign") ? await db.user.findMany({ where: { isActive: true, roles: { some: { role: { key: "DESIGNER" } } } }, select: { id: true, fullName: true } }) : [];
        return (<div className="space-y-4">
          {!o.requiresDesign && <Card><p className="text-sm">هذا الطلب لا يتطلب تصميمًا.</p></Card>}
          {o.requiresDesign && can(a, "design.assign") && <Card title="إسناد مهمة تصميم"><AssignDesign orderId={o.id} items={o.items.map((i) => ({ id: i.id, name: i.name }))} designers={designers} /></Card>}
          {o.designTasks.map((t) => (
            <Card key={t.id} title={<Link href={`/design/${t.id}`} className="text-cyan-deep">{t.number} — {t.orderItem?.name ?? "كل المنتجات"}</Link>} actions={<DesignBadge s={t.status} />}>
              <p className="text-sm">المصمم: {t.assignee?.fullName ?? "—"} — أُسند {dateTime(t.assignedAt)} — الموعد {date(t.dueDate)} — عدد التعديلات {t.revisionCount}</p>
              <ul className="mt-2 space-y-1 text-sm">{t.approvals.map((ap) => <li key={ap.id}>• {dateTime(ap.createdAt)} — {ap.decision === "CUSTOMER_APPROVED" ? `اعتمد العميل (${ap.approverName})` : ap.decision === "CUSTOMER_CHANGES" ? `طلب العميل تعديلًا: ${ap.feedback}` : ap.decision === "INTERNAL_APPROVED" ? "اعتماد داخلي" : `رفض داخلي: ${ap.feedback}`} — سجّله {ap.recordedBy.fullName} (النسخة {t.versions.find((v) => v.id === ap.versionId)?.versionNo})</li>)}</ul>
            </Card>))}
          {o.requiresDesign && !o.designTasks.length && <Card><Empty title="لم يُسند التصميم بعد" /></Card>}
        </div>);
      }

      case "production": {
        const [machines, workers] = can(a, "production.manage") ? await Promise.all([
          db.machine.findMany({ where: { isActive: true }, select: { id: true, name: true, status: true } }),
          db.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: ["PRODUCTION_WORKER", "PRODUCTION_SUPERVISOR"] } } } } }, select: { id: true, fullName: true } }),
        ]) : [[], []];
        const remainingItems = o.items.map((i) => ({ id: i.id, name: i.name, remaining: i.quantity - i.cancelledQty - o.productionOrders.filter((p) => p.orderItemId === i.id && !p.parentId && p.status !== "CANCELLED").reduce((s, p) => s + p.quantity, 0) })).filter((i) => i.remaining > 0);
        return (<div className="space-y-4">
          <Card title="أوامر التشغيل">{o.productionOrders.length ? (
            <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">الأمر</th><th className="th">المنتج</th><th className="th">الدفعة</th><th className="th">الكمية</th><th className="th">الآلة</th><th className="th">المسؤول</th><th className="th">المرحلة</th><th className="th">منجز/تالف</th><th className="th">الإنجاز</th><th className="th">الحالة</th></tr></thead>
              <tbody>{o.productionOrders.map((p) => <tr key={p.id} className="border-b border-paper-line/60">
                <td className="td"><Link href={`/production/${p.id}`} className="font-medium text-cyan-deep">{p.number}</Link>{p.parentId && <Badge tone="yellow">إعادة إنتاج</Badge>}</td>
                <td className="td">{p.orderItem.name}</td><td className="td">{p.batchNo}</td><td className="td">{n(p.quantity)}</td><td className="td">{p.machine?.name ?? "—"}</td><td className="td">{p.assignee?.fullName ?? "—"}</td>
                <td className="td">{p.stages.find((s) => s.status === "IN_PROGRESS")?.name ?? "—"}</td><td className="td tabular-nums">{n(p.completedQty)} / {n(p.scrapQty)}</td>
                <td className="td"><Progress value={p.progressPct} /></td><td className="td"><ProdBadge s={p.status} /></td></tr>)}</tbody></table></TableScroll>) : <Empty title="لا توجد أوامر تشغيل" />}
          </Card>
          {can(a, "production.manage") && !["CLOSED", "CANCELLED", "DELIVERED"].includes(o.status) && (
            <Card title="إنشاء أمر تشغيل / دفعة إنتاج">
              <CreateProduction orderId={o.id} items={remainingItems} machines={machines} workers={workers}
                stagesByItem={Object.fromEntries(o.items.filter((i) => i.category?.defaultStages.length).map((i) => [i.id, i.category!.defaultStages]))} />
            </Card>)}
        </div>);
      }

      case "quality": {
        const ins = o.productionOrders.flatMap((p) => p.inspections.map((i) => ({ ...i, po: p.number, product: p.orderItem.name })));
        return <Card>{ins.length ? <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">أمر التشغيل</th><th className="th">المنتج</th><th className="th">المفحوص</th><th className="th">المقبول</th><th className="th">المرفوض</th><th className="th">النتيجة</th><th className="th">الفاحص</th><th className="th">التاريخ</th><th className="th">ملاحظات</th></tr></thead>
          <tbody>{ins.map((i) => <tr key={i.id} className="border-b border-paper-line/60"><td className="td">{i.po}</td><td className="td">{i.product}</td><td className="td">{n(i.inspectedQty)}</td><td className="td">{n(i.acceptedQty)}</td><td className="td">{n(i.rejectedQty)}</td><td className="td"><Badge tone={i.result.startsWith("ACCEPTED") ? "green" : "red"}>{QC_RESULT[i.result]}</Badge></td><td className="td">{i.inspector.fullName}</td><td className="td">{dateTime(i.createdAt)}</td><td className="td text-ink-soft">{i.rejectReason ?? i.notes ?? "—"}</td></tr>)}</tbody></table></TableScroll> : <Empty title="لا توجد فحوصات بعد" />}</Card>;
      }

      case "delivery": {
        const ready = o.items.map((i) => ({ id: i.id, name: i.name, ready: Math.max(0, Math.min(i.approvedQty, i.quantity - i.cancelledQty) - i.deliveredQty) }));
        const justDone = searchParams.dn ? o.deliveries.find((d) => d.id === searchParams.dn) : undefined;
        return (<div className="space-y-4">
          {justDone && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">تم التسليم بسند {justDone.number} مع {justDone.proofs.length} صورة إثبات — <Link className="font-semibold underline" target="_blank" href={`/print/delivery/${justDone.id}`}>طباعة السند</Link></p>}
          <Card title="ملخص الكميات"><TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">المنتج</th><th className="th">المطلوب</th><th className="th">الجاهز</th><th className="th">المسلّم</th><th className="th">المتبقي</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.id} className="border-b border-paper-line/60"><td className="td">{i.name}</td><td className="td">{n(i.quantity - i.cancelledQty)}</td><td className="td">{n(i.approvedQty)}</td><td className="td">{n(i.deliveredQty)}</td><td className="td">{n(i.quantity - i.cancelledQty - i.deliveredQty)}</td></tr>)}</tbody></table></TableScroll></Card>
          {can(a, "delivery.manage") && ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"].includes(o.status) && ready.some((r) => r.ready > 0) && <Card title="تسليم جديد (جزئي أو كامل)"><DeliveryForm orderId={o.id} items={ready.filter((r) => r.ready > 0)} address={[o.customer.city, o.customer.address].filter(Boolean).join(" - ")} /></Card>}
          <Card title="سندات التسليم">{o.deliveries.length ? <ul className="space-y-2 text-sm">{o.deliveries.map((d) => <li key={d.id} className="flex items-center justify-between border-b border-paper-line/60 pb-2">
            <span><b>{d.number}</b> {d.isFinal ? <Badge tone="green">نهائي</Badge> : <Badge tone="yellow">جزئي</Badge>} — {dateTime(d.deliveredAt)} — {DELIVERY_METHOD[d.method]} — المستلم {d.recipientName} — {d.items.map((x) => `${n(x.quantity)} ${x.orderItem.name}`).join("، ")}</span>
            <span className="flex items-center gap-2">{d.proofs.length > 0 && <Badge tone="cyan">📷 {d.proofs.length}</Badge>}<Link className="text-cyan-deep" target="_blank" href={`/print/delivery/${d.id}`}>طباعة السند</Link></span></li>)}</ul> : <Empty title="لا توجد عمليات تسليم" />}</Card>
          {proofSection}
        </div>);
      }

      case "files": return (<Card>
        {can(a, "files.upload") && <div className="mb-4"><FileUpload orderId={o.id} /></div>}
        {o.attachments.length ? <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">الملف</th><th className="th">النوع</th><th className="th">الإصدار</th><th className="th">الحجم</th><th className="th">رفعه</th><th className="th">التاريخ</th></tr></thead>
          <tbody>{o.attachments.map((f) => <tr key={f.id} className="border-b border-paper-line/60"><td className="td"><a href={`/api/files/${f.id}`} className="text-cyan-deep">{f.originalName}</a></td><td className="td">{ATTACHMENT_KIND[f.kind]}</td><td className="td">v{f.versionNo}</td><td className="td">{(f.sizeBytes / 1024).toFixed(0)} KB</td><td className="td">{f.uploadedBy.fullName}</td><td className="td">{dateTime(f.createdAt)}</td></tr>)}</tbody></table></TableScroll> : <Empty title="لا توجد ملفات" />}
      </Card>);

      case "comments": return (<Card><CommentBox orderId={o.id} />
        <ul className="mt-4 space-y-3">{o.comments.map((c) => <li key={c.id} className="text-sm"><div className="text-xs text-ink-soft">{c.author.fullName} — {dateTime(c.createdAt)}</div><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ul></Card>);

      case "timeline": return (<Card>
        <ol className="relative space-y-4 border-s-2 border-paper-line ps-5">{o.events.map((e) => (
          <li key={e.id} className="relative"><span className="absolute -start-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-cyan-process" />
            <div className="text-xs text-ink-soft">{dateTime(e.createdAt)} — {e.actor?.fullName ?? "النظام"}</div>
            <div className="text-sm">{e.message}</div>
            {(e.data as { reason?: string } | null)?.reason && <div className="text-xs text-ink-soft">السبب: {(e.data as { reason: string }).reason}</div>}
          </li>))}</ol>
        <p className="mt-4 text-xs text-ink-faint">السجل الزمني للقراءة فقط ولا يمكن تعديله أو حذفه من داخل النظام.</p>
      </Card>);

      default: return (<div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card title="ملخص الطلب" className="sm:col-span-2 lg:col-span-2">
            <dl className="grid grid-cols-2 gap-3 text-sm wrap-anywhere lg:grid-cols-3">
              {[["العميل", <Link key="c" href={`/customers/${o.customer.id}`} className="text-cyan-deep">{o.customer.name}</Link>], ["موظف المبيعات", o.salesRep.fullName], ["أنشأه", `${o.createdBy.fullName} — ${dateTime(o.createdAt)}`],
                ["نوع الطلب", o.orderType ?? "—"], ["تاريخ التسليم", date(o.dueDate)],
                ["الدفعة المقدمة", o.depositReceived ? <Badge key="d" tone="green">مؤكدة</Badge> : <Badge key="d">غير مؤكدة</Badge>],
                ["يتطلب تصميمًا", o.requiresDesign ? "نعم" : "لا"], ["يتطلب فحص جودة", o.requiresQC ? "نعم" : "لا"], ["سبب التأخير/الإيقاف", o.delayReason ?? "—"]].map(([k, v]) => (
                <div key={k as string}><dt className="text-xs text-ink-soft">{k}</dt><dd>{v}</dd></div>))}
            </dl>
            {o.notes && <p className="mt-3 rounded bg-paper p-3 text-sm">{o.notes}</p>}
            <h3 className="mb-2 mt-4 text-sm font-semibold">المنتجات</h3>
            <ul className="space-y-1 text-sm">{o.items.map((i) => <li key={i.id}>{i.name} × {n(i.quantity)} {i.unit}</li>)}</ul>
          </Card>
          <div className="space-y-4">
            {m && <Card title="قيمة الطلب">
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-ink-soft">القيمة</dt><dd className="font-bold">{money(m.total)}</dd></div>
                <div><dt className="text-xs text-ink-soft">المدفوع</dt><dd className="font-bold text-emerald-700">{money(m.paidAmount)}</dd></div>
                <div><dt className="text-xs text-ink-soft">المتبقي</dt><dd className="font-bold text-magenta-process">{money(m.remaining)}</dd></div>
              </dl>
              {can(a, "orders.edit_value") && !["CLOSED", "CANCELLED"].includes(o.status) && <div className="mt-3 border-t border-paper-line pt-3"><MoneyForm orderId={o.id} version={o.version} total={m.total} paidAmount={m.paidAmount} /></div>}
            </Card>}
            {can(a, "orders.set_deposit") && !["CLOSED", "CANCELLED"].includes(o.status) && <Card title="الدفعة المقدمة"><DepositToggle orderId={o.id} received={o.depositReceived} /></Card>}
            {!["CLOSED", "CANCELLED"].includes(o.status) && (can(a, "orders.edit") || can(a, "orders.reassign")) && await (async () => {
              const reps = can(a, "orders.reassign") ? await db.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: ["SALES", "SALES_SUPERVISOR"] } } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : [];
              return <Card title="الموعد والمسؤول">
                <div className="space-y-4">
                  {can(a, "orders.edit") && <DueDateForm orderId={o.id} version={o.version} current={riyadhYmd(o.dueDate)} minDate={riyadhYmd()} />}
                  {can(a, "orders.reassign") && <div className="border-t border-paper-line pt-3"><ReassignRepForm orderId={o.id} version={o.version} currentRepId={o.salesRepId} reps={reps} /></div>}
                </div>
              </Card>;
            })()}
            {can(a, "orders.change_status") || can(a, "orders.close") || can(a, "orders.cancel") ? <Card title="تغيير الحالة"><StatusControl orderId={o.id} version={o.version} current={o.status} /></Card> : null}
            <Card title="رمز QR للطلب"><div className="flex items-center gap-3"><img src={qr} alt={`QR ${o.number}`} width={110} height={110} /><p className="text-xs text-ink-soft">يفتح صفحة الطلب عند المسح، ويتطلب تسجيل الدخول والصلاحية.</p></div></Card>
          </div>
        </div>
        {proofSection}
      </div>);
    }
  })();

  return (
    <>
      <PageHeader title={`الطلب ${o.number}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><OrderBadge s={o.status} />{late && <LateBadge />}<PriorityBadge p={o.priority} /><span className="wrap-anywhere">{o.customer.name}</span><span className="w-32"><Progress value={progressOf(o.status)} /></span></span>}
        actions={<Link className="btn-ghost" href="/orders">رجوع للقائمة</Link>} />
      {/* على الجوال: تمرير أفقي داخل الشريط فقط، والتبويب النشط يُعرض تلقائيًا */}
      <nav id="order-tabs" aria-label="أقسام الطلب" className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-paper-line px-4 sm:mx-0 sm:px-0">
        {TABS.map(([k, label]) => <Link key={k} href={`/orders/${o.id}?tab=${k}`} scroll={false} aria-current={tab === k ? "page" : undefined} className={cx("tab shrink-0 whitespace-nowrap", tab === k && "tab-active")}>{label}</Link>)}
      </nav>
      <ScrollActiveIntoView container="#order-tabs" />
      {tabBody}
    </>
  );
}

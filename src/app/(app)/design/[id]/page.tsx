import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Field } from "@/components/ui";
import { DesignBadge } from "@/components/status";
import { ActionButton, FormAction } from "@/components/client";
import { startDesignAction, uploadDesignAction, internalReviewAction, customerDecisionAction } from "@/server/actions";
import { date, dateTime, n } from "@/lib/format";
import { inOrderScope } from "@/lib/order-access";

export default async function DesignTaskPage({ params }: { params: { id: string } }) {
  const a = await requireActor(); pagePerm(a, "design.view");
  const t = await db.designTask.findUnique({
    where: { id: params.id },
    include: {
      order: { select: { id: true, number: true, salesRepId: true, customer: { select: { name: true } }, attachments: { where: { kind: "REFERENCE" } } } },
      orderItem: true, assignee: { select: { fullName: true } },
      versions: { orderBy: { versionNo: "desc" }, include: { files: true, uploadedBy: { select: { fullName: true } } } },
      approvals: { orderBy: { createdAt: "desc" }, include: { recordedBy: { select: { fullName: true } } } },
    },
  });
  if (!t) notFound();
  if (!can(a, "design.assign") && t.assigneeId !== a.id && !(can(a, "orders.view") && inOrderScope(a, t.order))) notFound();
  const mine = t.assigneeId === a.id || can(a, "design.assign");
  const i = t.orderItem;
  return (
    <>
      <PageHeader title={`مهمة التصميم ${t.number}`} subtitle={<span className="flex items-center gap-2"><DesignBadge s={t.status} /> <Link href={`/orders/${t.order.id}?tab=design`} className="text-cyan-deep">{t.order.number}</Link> — {t.order.customer.name}</span>} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card title="تفاصيل المهمة">
          <dl className="space-y-2 text-sm">
            {[["المنتج", i?.name ?? "كل المنتجات"], ["الكمية", i ? n(i.quantity) : "—"], ["المقاسات", i ? [i.length, i.width, i.height].filter(Boolean).map(Number).join(" × ") || "—" : "—"],
              ["الخامة", i?.material], ["الطباعة والألوان", [i?.printType, i?.colors].filter(Boolean).join(" — ")], ["المصمم", t.assignee?.fullName], ["تاريخ الإسناد", dateTime(t.assignedAt)],
              ["موعد التسليم", date(t.dueDate)], ["عدد التعديلات", String(t.revisionCount)]].map(([k, v]) => <div key={k as string}><dt className="text-xs text-ink-soft">{k}</dt><dd>{v || "—"}</dd></div>)}
          </dl>
          {t.instructions && <><h3 className="mt-3 text-xs text-ink-soft">تعليمات التصميم</h3><p className="whitespace-pre-wrap text-sm">{t.instructions}</p></>}
          {i?.technicalNotes && <><h3 className="mt-3 text-xs text-ink-soft">ملاحظات فنية</h3><p className="text-sm">{i.technicalNotes}</p></>}
          {t.order.attachments.length > 0 && <><h3 className="mt-3 text-xs text-ink-soft">الملفات المرجعية</h3><ul className="text-sm">{t.order.attachments.map((f) => <li key={f.id}><a className="text-cyan-deep" href={`/api/files/${f.id}`}>{f.originalName}</a></li>)}</ul></>}
          {t.status === "PENDING" && mine && <div className="mt-4"><ActionButton className="btn-primary" action={startDesignAction.bind(null, t.id)}>بدء العمل</ActionButton></div>}
        </Card>

        <div className="sm:col-span-2 lg:col-span-2 space-y-4">
          {mine && can(a, "design.work") && !["APPROVED", "CANCELLED", "SENT_TO_CUSTOMER"].includes(t.status) && (
            <Card title={`رفع نسخة جديدة (ستكون النسخة ${(t.versions[0]?.versionNo ?? 0) + 1})`}>
              <FormAction action={uploadDesignAction.bind(null, t.id)} className="space-y-3">
                <Field label="ملفات التصميم (AI, PSD, PDF, SVG, JPG, PNG, TIFF, EPS)"><input type="file" name="files" multiple required className="input" accept=".ai,.psd,.pdf,.svg,.jpg,.jpeg,.png,.tif,.tiff,.eps" /></Field>
                <Field label="ملاحظات النسخة"><input name="notes" className="input" /></Field>
                <button className="btn-primary">رفع وإرسال للمراجعة الداخلية</button>
              </FormAction>
            </Card>)}

          {can(a, "design.approve") && t.status === "INTERNAL_REVIEW" && (
            <Card title="المراجعة الداخلية">
              <div className="flex gap-2">
                <ActionButton className="btn-primary" confirm="اعتماد داخلي وإرسال التصميم للعميل؟" action={internalReviewAction.bind(null, t.id, true)}>اعتماد وإرسال للعميل</ActionButton>
                <ActionButton className="btn-danger" askReason="ملاحظات التعديل للمصمم:" action={internalReviewAction.bind(null, t.id, false)}>إعادة للمصمم</ActionButton>
              </div>
            </Card>)}

          {can(a, "design.approve") && t.status === "SENT_TO_CUSTOMER" && (
            <Card title={`تسجيل قرار العميل على النسخة ${t.versions[0]?.versionNo}`}>
              <FormAction action={customerDecisionAction.bind(null, t.id)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
                <Field label="القرار"><select name="approved" className="input"><option value="yes">اعتمد العميل التصميم</option><option value="no">طلب العميل تعديلات</option></select></Field>
                <Field label="اسم المعتمد لدى العميل *"><input name="approverName" className="input" required /></Field>
                <Field label="ملاحظات العميل" className="sm:col-span-2 lg:col-span-2"><textarea name="feedback" className="input" rows={2} /></Field>
                <Field label="إثبات الموافقة (صورة محادثة، بريد، توقيع)" className="sm:col-span-2 lg:col-span-2"><input type="file" name="proof" className="input" accept=".pdf,.jpg,.jpeg,.png" /></Field>
                <div><button className="btn-primary">حفظ القرار</button></div>
              </FormAction>
            </Card>)}

          <Card title="النسخ (لا تُستبدل أي نسخة سابقة)">
            {t.versions.length ? t.versions.map((v) => (
              <div key={v.id} className="border-b border-paper-line py-2 last:border-0">
                <div className="text-sm font-semibold">النسخة {v.versionNo} {t.approvedVersionId === v.id && <span className="text-emerald-700">— المعتمدة النهائية</span>}</div>
                <div className="text-xs text-ink-soft">{v.uploadedBy.fullName} — {dateTime(v.createdAt)}{v.notes ? ` — ${v.notes}` : ""}</div>
                <ul className="mt-1 flex flex-wrap gap-3 text-sm">{v.files.map((f) => <li key={f.id}><a className="text-cyan-deep" href={`/api/files/${f.id}`}>{f.originalName}</a></li>)}</ul>
              </div>)) : <Empty title="لم تُرفع أي نسخة بعد" />}
          </Card>

          <Card title="سجل المراجعات والاعتمادات">
            {t.approvals.length ? <ul className="space-y-1 text-sm">{t.approvals.map((ap) => <li key={ap.id}>{dateTime(ap.createdAt)} — {{ INTERNAL_APPROVED: "اعتماد داخلي", INTERNAL_REJECTED: "إعادة داخلية", CUSTOMER_APPROVED: `اعتماد العميل (${ap.approverName})`, CUSTOMER_CHANGES: `تعديل من العميل (${ap.approverName})` }[ap.decision]}{ap.feedback ? `: ${ap.feedback}` : ""} — {ap.recordedBy.fullName}{ap.proofAttachmentId && <> — <a className="text-cyan-deep" href={`/api/files/${ap.proofAttachmentId}`}>الإثبات</a></>}</li>)}</ul> : <Empty title="لا توجد مراجعات" />}
          </Card>
        </div>
      </div>
    </>
  );
}

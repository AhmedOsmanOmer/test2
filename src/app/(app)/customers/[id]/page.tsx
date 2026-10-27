import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { maskContact } from "@/server/services/customers";
import { PageHeader, Card, Empty, ResponsiveTable } from "@/components/ui";
import { OrderBadge } from "@/components/status";
import { orderScope, orderMoneyView } from "@/lib/order-access";
import { FormAction } from "@/components/client";
import { logCommunicationFormAction } from "@/server/actions";
import { money, date, dateTime } from "@/lib/format";

export default async function CustomerPage({ params }: { params: { id: string } }) {
  const a = await requireActor(); pagePerm(a, "customers.view");
  const raw = await db.customer.findUnique({
    where: { id: params.id },
    include: {
      contacts: true, communications: { orderBy: { createdAt: "desc" }, take: 20 },
      // العملاء للجميع، لكن طلباتهم حسب نطاق المستخدم
      orders: { where: orderScope(a), orderBy: { createdAt: "desc" }, include: { items: { select: { name: true, quantity: true } } } },
      attachments: { where: { orderId: null }, orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!raw) notFound();
  const c = maskContact(a, raw);
  const perOrder = can(a, "orders.view_value");
  // الإجماليات للمدير العام فقط، ودون الطلبات الملغاة (F24)
  const active = c.orders.filter((o) => o.status !== "CANCELLED");
  const totalValue = active.reduce((s, o) => s + Number(o.total), 0);
  const paid = active.reduce((s, o) => s + Number(o.paidAmount), 0);
  return (
    <>
      <PageHeader title={c.name} subtitle={`${c.code} — ${c.type === "COMPANY" ? "شركة" : "فرد"}${c.city ? ` — ${c.city}` : ""}`}
        actions={can(a, "orders.create") && <Link className="btn-primary" href={`/orders/new?customer=${c.id}`}>طلب جديد لهذا العميل</Link>} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="البيانات" className="col-span-1">
          <dl className="space-y-2 text-sm">
            {[["الجوال", c.phone], ["واتساب", c.whatsapp], ["البريد", c.email], ["العنوان", c.address], ["السجل التجاري", c.crNumber], ["الرقم الضريبي", c.vatNumber], ["التصنيف", c.category]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs text-ink-soft">{k}</dt><dd dir="auto">{v || "—"}</dd></div>))}
            {c.contacts.map((ct) => <div key={ct.id}><dt className="text-xs text-ink-soft">مسؤول التواصل</dt><dd>{ct.name}</dd></div>)}
            {c.internalNotes && <div><dt className="text-xs text-ink-soft">ملاحظات داخلية</dt><dd className="whitespace-pre-wrap">{c.internalNotes}</dd></div>}
          </dl>
        </Card>
        <div className="sm:col-span-full lg:col-span-3 space-y-4">
          {can(a, "dashboard.financial") && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4"><div className="text-xs text-ink-soft">إجمالي قيمة الطلبات (دون الملغاة)</div><div className="text-xl font-bold">{money(totalValue)}</div></div>
            <div className="card p-4"><div className="text-xs text-ink-soft">المدفوع</div><div className="text-xl font-bold">{money(paid)}</div></div>
            <div className="card p-4"><div className="text-xs text-ink-soft">المتبقي</div><div className="text-xl font-bold text-magenta-process">{money(totalValue - paid)}</div></div>
            <div className="card p-4"><div className="text-xs text-ink-soft">آخر طلب</div><div className="text-xl font-bold">{date(c.orders[0]?.createdAt)}</div></div>
          </div>}
          <Card title={`الطلبات (${c.orders.length})`}>
            {c.orders.length ? <ResponsiveTable minWidth={720} cards={c.orders.map((o) => {
              const m = perOrder ? orderMoneyView(a, o) : null;
              return { key: o.id, href: `/orders/${o.id}`, title: o.number, badge: <OrderBadge s={o.status} />,
                lines: [o.items.map((i) => `${i.name} × ${i.quantity}`).join("، "), date(o.createdAt), ...(m ? [`القيمة ${money(m.total)} — المتبقي ${money(m.remaining)}`] : [])],
                actions: can(a, "orders.create") ? <Link className="btn-ghost" href={`/orders/new?repeat=${o.id}`}>تكرار الطلب</Link> : undefined };
            })}><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">الطلب</th><th className="th">المنتجات</th><th className="th">الحالة</th>{perOrder && <th className="th">القيمة</th>}{perOrder && <th className="th">المتبقي</th>}<th className="th">التاريخ</th><th className="th"></th></tr></thead>
              <tbody>{c.orders.map((o) => <tr key={o.id} className="border-b border-paper-line/60">
                <td className="td"><Link href={`/orders/${o.id}`} className="font-medium text-cyan-deep">{o.number}</Link></td>
                <td className="td text-ink-soft">{o.items.map((i) => `${i.name} × ${i.quantity}`).join("، ")}</td>
                <td className="td"><OrderBadge s={o.status} /></td>{perOrder && (() => { const m = orderMoneyView(a, o)!; return <><td className="td">{money(m.total)}</td><td className="td">{money(m.remaining)}</td></>; })()}
                <td className="td">{date(o.createdAt)}</td>
                <td className="td">{can(a, "orders.create") && <Link className="text-sm text-cyan-deep" href={`/orders/new?repeat=${o.id}`}>تكرار الطلب</Link>}</td>
              </tr>)}</tbody></table></ResponsiveTable> : <Empty title="لا توجد طلبات" />}
          </Card>
          <Card title="سجل التواصل">
            {can(a, "customers.manage") && <FormAction className="mb-3 flex flex-col gap-2 sm:flex-row" action={logCommunicationFormAction.bind(null, c.id)}>
              <select name="channel" className="input sm:w-32" aria-label="قناة التواصل"><option>هاتف</option><option>واتساب</option><option>بريد</option><option>زيارة</option></select>
              <input name="summary" className="input" placeholder="ملخص التواصل" aria-label="ملخص التواصل" required /><button className="btn-primary">إضافة</button>
            </FormAction>}
            {c.communications.length ? <ul className="space-y-2 text-sm">{c.communications.map((m) => <li key={m.id}><span className="text-ink-soft">{dateTime(m.createdAt)} — {m.channel}:</span> {m.summary}</li>)}</ul> : <Empty title="لا يوجد سجل تواصل" />}
          </Card>
          <Card title="الملفات">{c.attachments.length ? <ul className="text-sm">{c.attachments.map((f) => <li key={f.id}><a className="text-cyan-deep" href={`/api/files/${f.id}`}>{f.originalName}</a> <span className="text-ink-soft">— {dateTime(f.createdAt)}</span></li>)}</ul> : <Empty title="لا ملفات" />}</Card>
        </div>
      </div>
    </>
  );
}

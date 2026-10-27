import Link from "next/link";
import { requireActor, pagePerm } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, TableScroll, ResponsiveTable } from "@/components/ui";
import { OrderBadge } from "@/components/status";
import { DELIVERY_METHOD } from "@/lib/labels";
import { n, date, dateTime } from "@/lib/format";
import { orderScope } from "@/lib/order-access";

export default async function Delivery() {
  const a = await requireActor(); pagePerm(a, "delivery.view");
  const scope = orderScope(a);
  const [ready, recent] = await Promise.all([
    db.order.findMany({ where: { ...scope, status: { in: ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"] } }, orderBy: { dueDate: "asc" }, include: { customer: { select: { name: true, city: true } }, items: { select: { name: true, quantity: true, approvedQty: true, deliveredQty: true, cancelledQty: true } } } }),
    db.delivery.findMany({ where: { order: scope }, orderBy: { createdAt: "desc" }, take: 30, include: { _count: { select: { proofs: true } }, order: { select: { id: true, number: true, customer: { select: { name: true } } } }, items: { include: { orderItem: { select: { name: true } } } } } }),
  ]);
  return (
    <>
      <PageHeader title="التسليم" subtitle={`${ready.length} طلب جاهز أو قيد التسليم`} />
      <div className="space-y-4">
        <Card title="جاهز / تحت التسليم">{ready.length ? <ResponsiveTable minWidth={760} cards={ready.map((o) => ({
          key: o.id, title: o.number, badge: <OrderBadge s={o.status} />,
          lines: [`${o.customer.name}${o.customer.city ? ` — ${o.customer.city}` : ""}`, o.items.map((i) => `${i.name}: ${n(i.deliveredQty)} / ${n(i.quantity - i.cancelledQty)}`).join(" — "), `موعد التسليم ${date(o.dueDate)}`],
          actions: <Link className="btn-primary" href={`/orders/${o.id}?tab=delivery`}>تسليم</Link>,
        }))}><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">الطلب</th><th className="th">العميل</th><th className="th">المدينة</th><th className="th">المنتجات (مسلّم / مطلوب)</th><th className="th">موعد التسليم</th><th className="th">الحالة</th><th className="th"></th></tr></thead>
          <tbody>{ready.map((o) => <tr key={o.id} className="border-b border-paper-line/60"><td className="td font-medium">{o.number}</td><td className="td">{o.customer.name}</td><td className="td">{o.customer.city ?? "—"}</td>
            <td className="td text-sm">{o.items.map((i) => `${i.name}: ${n(i.deliveredQty)} / ${n(i.quantity - i.cancelledQty)}`).join(" — ")}</td><td className="td">{date(o.dueDate)}</td><td className="td"><OrderBadge s={o.status} /></td>
            <td className="td"><Link className="btn-primary" href={`/orders/${o.id}?tab=delivery`}>تسليم</Link></td></tr>)}</tbody></table></ResponsiveTable> : <Empty title="لا توجد طلبات جاهزة للتسليم" />}</Card>
        <Card title="آخر سندات التسليم">{recent.length ? <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">السند</th><th className="th">الطلب</th><th className="th">العميل</th><th className="th">الكميات</th><th className="th">الطريقة</th><th className="th">المستلم</th><th className="th">التاريخ</th></tr></thead>
          <tbody>{recent.map((d) => <tr key={d.id} className="border-b border-paper-line/60"><td className="td"><Link className="text-cyan-deep" target="_blank" href={`/print/delivery/${d.id}`}>{d.number}</Link> {d.isFinal ? "(نهائي)" : "(جزئي)"}{d._count.proofs > 0 && <span className="ms-1 whitespace-nowrap text-xs text-cyan-deep" title="صور إثبات التسليم">📷 {d._count.proofs}</span>}</td><td className="td"><Link className="text-cyan-deep" href={`/orders/${d.order.id}?tab=delivery`}>{d.order.number}</Link></td><td className="td">{d.order.customer.name}</td><td className="td text-sm">{d.items.map((x) => `${n(x.quantity)} ${x.orderItem.name}`).join("، ")}</td><td className="td">{DELIVERY_METHOD[d.method]}</td><td className="td">{d.recipientName}</td><td className="td">{dateTime(d.deliveredAt)}</td></tr>)}</tbody></table></TableScroll> : <Empty title="لا توجد سندات" />}</Card>
      </div>
    </>
  );
}

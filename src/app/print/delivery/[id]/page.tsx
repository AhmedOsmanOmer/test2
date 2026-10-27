import { notFound } from "next/navigation";
import { requireActor, pageAny } from "@/server/auth";
import { db } from "@/lib/db";
import { Doc } from "../../doc";
import { DELIVERY_METHOD } from "@/lib/labels";
import { n, dateTime } from "@/lib/format";
import { inOrderScope } from "@/lib/order-access";

export default async function DeliveryNote({ params }: { params: { id: string } }) {
  const a = await requireActor(); pageAny(a, "delivery.view", "orders.view");
  const d = await db.delivery.findUnique({ where: { id: params.id }, include: { order: { select: { number: true, salesRepId: true, customer: { select: { name: true } } } }, items: { include: { orderItem: true } }, handler: { select: { fullName: true } } } });
  if (!d || !inOrderScope(a, d.order)) notFound();
  return (
    <Doc title={d.isFinal ? "سند تسليم نهائي" : "سند تسليم جزئي"} number={d.number}>
      <section className="my-4 grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
        <div><b>العميل:</b> {d.order.customer.name}<br /><b>رقم الطلب:</b> {d.order.number}<br /><b>عنوان التسليم:</b> {d.address ?? "—"}</div>
        <div><b>تاريخ التسليم:</b> {dateTime(d.deliveredAt)}<br /><b>طريقة التسليم:</b> {DELIVERY_METHOD[d.method]}<br /><b>المسؤول:</b> {d.handler?.fullName ?? "—"}</div>
      </section>
      <div className="table-scroll print:overflow-visible"><table className="w-full min-w-[560px] border-collapse print:min-w-0"><thead><tr className="bg-black/5">{["#", "المنتج", "الكمية المطلوبة", "المسلّمة في هذا السند", "إجمالي المسلّم", "المتبقي"].map((h) => <th key={h} className="border border-black/20 p-2 text-start">{h}</th>)}</tr></thead>
        <tbody>{d.items.map((x, i) => { const it = x.orderItem; const req = it.quantity - it.cancelledQty; return <tr key={x.id}><td className="border border-black/20 p-2">{i + 1}</td><td className="border border-black/20 p-2">{it.name}</td><td className="border border-black/20 p-2">{n(req)}</td><td className="border border-black/20 p-2 font-bold">{n(x.quantity)}</td><td className="border border-black/20 p-2">{n(it.deliveredQty)}</td><td className="border border-black/20 p-2">{n(req - it.deliveredQty)}</td></tr>; })}</tbody></table></div>
      <p className="mt-2 text-xs">الأعمدة «إجمالي المسلّم» و«المتبقي» تعكس الوضع وقت طباعة السند.</p>
      {d.notes && <p className="mt-3"><b>ملاحظات:</b> {d.notes}</p>}
      <section className="mt-16 grid grid-cols-1 gap-10 sm:grid-cols-2 print:grid-cols-2">
        <div><b>اسم المستلم:</b> {d.recipientName}<div className="mt-10 border-t border-black pt-1">توقيع المستلم</div></div>
        <div><b>عن الشركة:</b> {d.handler?.fullName}<div className="mt-10 border-t border-black pt-1">التوقيع والختم</div></div>
      </section>
    </Doc>
  );
}

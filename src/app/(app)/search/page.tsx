import Link from "next/link";
import { requireActor } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty } from "@/components/ui";
import { OrderBadge } from "@/components/status";
import { orderScope } from "@/lib/order-access";

export default async function Search({ searchParams }: { searchParams: { q?: string } }) {
  const a = await requireActor();
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  if (!q) return <><PageHeader title="بحث" /><Card><Empty title="اكتب كلمة للبحث في الأعلى" /></Card></>;
  const ci = { contains: q, mode: "insensitive" as const };
  // نفس نطاق الطلبات في كل مكان: الطلبات وملفاتها وأوامر تشغيلها
  const scope = orderScope(a);
  const scoped = Object.keys(scope).length > 0;
  const [orders, customers, files, prods] = await Promise.all([
    can(a, "orders.view") ? db.order.findMany({ where: { ...scope, OR: [{ number: ci }, { customer: { name: ci } }, { items: { some: { name: ci } } }] }, take: 20, orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, customer: { select: { name: true } } } }) : [],
    can(a, "customers.view") ? db.customer.findMany({ where: { OR: [{ name: ci }, { code: ci }, ...(can(a, "customers.contact") ? [{ phone: { contains: q } }] : [])] }, take: 20, select: { id: true, name: true, code: true } }) : [],
    can(a, "files.view") ? db.attachment.findMany({ where: { originalName: ci, ...(scoped ? { OR: [{ orderId: null }, { order: scope }] } : {}) }, take: 20, select: { id: true, originalName: true, order: { select: { number: true } } } }) : [],
    can(a, "production.view") ? db.productionOrder.findMany({ where: { number: ci, ...(scoped ? { order: scope } : {}) }, take: 10, select: { id: true, number: true } }) : [],
  ]);
  if (orders.length === 1 && !customers.length && orders[0].number.toLowerCase() === q.toLowerCase()) {
    const { redirect } = await import("next/navigation"); redirect(`/orders/${orders[0].id}`);
  }
  return (
    <>
      <PageHeader title={`نتائج البحث عن «${q}»`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        <Card title={`الطلبات (${orders.length})`}>{orders.length ? <ul className="space-y-1 text-sm">{orders.map((o) => <li key={o.id} className="flex justify-between"><Link className="text-cyan-deep" href={`/orders/${o.id}`}>{o.number} — {o.customer.name}</Link><OrderBadge s={o.status} /></li>)}</ul> : <Empty title="لا نتائج" />}</Card>
        <Card title={`العملاء (${customers.length})`}>{customers.length ? <ul className="space-y-1 text-sm">{customers.map((c) => <li key={c.id}><Link className="text-cyan-deep" href={`/customers/${c.id}`}>{c.name} — {c.code}</Link></li>)}</ul> : <Empty title="لا نتائج" />}</Card>
        <Card title={`أوامر التشغيل (${prods.length})`}>{prods.length ? <ul className="space-y-1 text-sm">{prods.map((p) => <li key={p.id}><Link className="text-cyan-deep" href={`/production/${p.id}`}>{p.number}</Link></li>)}</ul> : <Empty title="لا نتائج" />}</Card>
        <Card title={`الملفات (${files.length})`}>{files.length ? <ul className="space-y-1 text-sm">{files.map((f) => <li key={f.id}><a className="text-cyan-deep" href={`/api/files/${f.id}`}>{f.originalName}</a> {f.order && <span className="text-ink-soft">— {f.order.number}</span>}</li>)}</ul> : <Empty title="لا نتائج" />}</Card>
      </div>
    </>
  );
}

import { requireActor, pagePerm } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { SALES_REP_ROLES } from "@/lib/permissions";
import { inOrderScope } from "@/lib/order-access";
import { riyadhYmd } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { OrderForm, type ItemDraft } from "./form";

export default async function NewOrder({ searchParams }: { searchParams: { customer?: string; repeat?: string } }) {
  const a = await requireActor(); pagePerm(a, "orders.create");
  // من لا يرى كل الطلبات يُسنَد الطلب إليه دائمًا، فلا قائمة مندوبين
  const chooseRep = can(a, "orders.view_all");
  const [customers, categories, reps, repeatRaw] = await Promise.all([
    db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true }, take: 2000 }),
    db.productCategory.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    chooseRep ? db.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: SALES_REP_ROLES } } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : [],
    searchParams.repeat ? db.order.findUnique({ where: { id: searchParams.repeat }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null,
  ]);
  const repeat = repeatRaw && inOrderScope(a, repeatRaw) ? repeatRaw : null;
  const items: ItemDraft[] | undefined = repeat?.items.map((i) => ({
    name: i.name, description: i.description ?? "", categoryId: i.categoryId ?? "", quantity: i.quantity, unit: i.unit,
    length: i.length ? Number(i.length) : undefined, width: i.width ? Number(i.width) : undefined, material: i.material ?? "", printType: i.printType ?? "",
    colors: i.colors ?? "", finishing: i.finishing ?? "", packaging: i.packaging ?? "", technicalNotes: i.technicalNotes ?? "",
  }));
  return (
    <>
      <PageHeader title={repeat ? `تكرار الطلب ${repeat.number}` : "طلب جديد"} subtitle="رقم الطلب يُولّد تلقائيًا عند الحفظ" />
      <OrderForm customers={customers} categories={categories} reps={chooseRep ? reps : null} me={a.id} minDate={riyadhYmd()}
        initialCustomer={searchParams.customer ?? repeat?.customerId} initialItems={items} showValue={can(a, "orders.edit_value")} canImport={can(a, "orders.import_items")} />
    </>
  );
}

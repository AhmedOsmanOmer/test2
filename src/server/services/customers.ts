import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requirePerm, can, type Actor } from "../actor";
import { audit, nextNumber } from "./audit";

const phone = z.string().trim().regex(/^[+0-9\s-]{7,20}$/, "رقم غير صالح").optional().or(z.literal("").transform(() => undefined));
export const customerSchema = z.object({
  name: z.string().trim().min(2, "الاسم مطلوب").max(200),
  type: z.enum(["INDIVIDUAL", "COMPANY"]),
  phone, whatsapp: phone,
  email: z.string().trim().email("بريد غير صالح").optional().or(z.literal("").transform(() => undefined)),
  city: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  crNumber: z.string().trim().max(20).optional(),
  vatNumber: z.string().trim().regex(/^(3\d{13}3)?$/, "الرقم الضريبي السعودي 15 رقمًا يبدأ وينتهي بـ 3").optional(),
  category: z.string().trim().max(50).optional(),
  contactName: z.string().trim().max(100).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export async function createCustomer(actor: Actor, input: CustomerInput) {
  requirePerm(actor, "customers.manage");
  const d = customerSchema.parse(input);
  return db.$transaction(async (tx) => {
    const code = await nextNumber(tx, "C", 5);
    const { contactName, ...rest } = d;
    const c = await tx.customer.create({
      data: {
        ...rest, code, branchId: actor.branchId,
        contacts: contactName ? { create: { name: contactName, phone: d.phone, email: d.email, isPrimary: true } } : undefined,
      },
    });
    await audit(tx, actor.id, "CUSTOMER_CREATE", "Customer", c.id, null, { code, name: c.name });
    return c;
  });
}

export async function updateCustomer(actor: Actor, id: string, input: CustomerInput) {
  requirePerm(actor, "customers.manage");
  const d = customerSchema.parse(input);
  const before = await db.customer.findUnique({ where: { id } });
  if (!before) throw notFound();
  const { contactName: _c, ...rest } = d;
  const after = await db.customer.update({ where: { id }, data: rest });
  await audit(db, actor.id, "CUSTOMER_UPDATE", "Customer", id, before, after);
  return after;
}

/** يحذف بيانات التواصل الحساسة لمن لا يملك صلاحيتها */
export function maskContact<T extends { phone?: string | null; whatsapp?: string | null; email?: string | null }>(actor: Actor, c: T): T {
  if (can(actor, "customers.contact")) return c;
  return { ...c, phone: c.phone ? "••••" + c.phone.slice(-3) : null, whatsapp: null, email: null };
}

export async function listCustomers(actor: Actor, q?: string, page = 1) {
  requirePerm(actor, "customers.view");
  const where = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { code: { contains: q } }, { phone: { contains: q } }, { vatNumber: { contains: q } }] }
    : {};
  const [rows, total] = await Promise.all([
    db.customer.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25,
      include: { _count: { select: { orders: true } }, orders: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
    }),
    db.customer.count({ where }),
  ]);
  return { rows: rows.map((r) => maskContact(actor, r)), total };
}

export async function logCommunication(actor: Actor, customerId: string, channel: string, summary: string) {
  requirePerm(actor, "customers.manage");
  if (!summary.trim()) throw new Error("الملخص مطلوب");
  return db.communicationLog.create({ data: { customerId, channel, summary: summary.trim().slice(0, 2000), userId: actor.id } });
}

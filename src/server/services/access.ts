import { db, type DB, type Tx } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { inOrderScope } from "@/lib/order-access";
import type { Actor } from "../actor";

export { orderScope, orderMoneyView } from "@/lib/order-access";

/**
 * يتحقق أن الطلب موجود وضمن نطاق المستخدم. خارج النطاق = «غير موجود» (لا نكشف وجوده).
 * يُستدعى في كل خدمة وإجراء يستقبل معرّف طلب.
 */
export async function assertOrderAccess(actor: Actor, orderId: string, c: DB | Tx = db) {
  const o = await c.order.findUnique({ where: { id: orderId }, select: { id: true, salesRepId: true } });
  if (!o || !inOrderScope(actor, o)) throw notFound("الطلب غير موجود");
  return o;
}

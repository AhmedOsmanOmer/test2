/**
 * نطاق الطلبات ورؤية المال — منطق نقي (بدون قاعدة بيانات) ليسهل اختباره.
 * - من يملك orders.view_all يرى كل الطلبات؛ غيره يرى الطلبات المسندة إليه كموظف مبيعات فقط.
 * - قيمة الطلب والمدفوع والمتبقي لا تخرج من الخادم إلا لمن يملك orders.view_value.
 */
import type { PermissionKey } from "./permissions";
import { round2 } from "./format";

export interface AccessSubject { id: string; permissions: Set<PermissionKey> }
export interface OrderMoney { total: number; paidAmount: number; remaining: number }

/** شرط Prisma يُضاف لكل قراءة طلبات (where) */
export function orderScope(a: AccessSubject): { salesRepId?: string } {
  return a.permissions.has("orders.view_all") ? {} : { salesRepId: a.id };
}

export function inOrderScope(a: AccessSubject, order: { salesRepId: string }) {
  return a.permissions.has("orders.view_all") || order.salesRepId === a.id;
}

/** المال المسموح عرضه لهذا المستخدم أو null */
export function orderMoneyView(a: AccessSubject, o: { total: unknown; paidAmount: unknown }): OrderMoney | null {
  if (!a.permissions.has("orders.view_value")) return null;
  const total = Number(o.total ?? 0), paidAmount = Number(o.paidAmount ?? 0);
  return { total, paidAmount, remaining: round2(total - paidAmount) };
}

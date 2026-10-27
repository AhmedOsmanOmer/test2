/**
 * قواعد مستلمي إشعارات الطلب — منطق نقي بدون قاعدة بيانات ليسهل اختبار المصفوفة.
 * لا تحتوي أي نصوص إشعار على مبالغ إطلاقًا.
 */
import type { OrderStatus } from "@/generated/prisma/enums";
import type { PermissionKey } from "./permissions";

export type OrderEventKind =
  | "ORDER_NEW" | "ORDER_STATUS_CHANGED" | "DEPOSIT_RECEIVED" | "ORDER_REP_CHANGED" | "ORDER_DUE_CHANGED"
  | "ORDER_COMMENT" | "DUE_SOON" | "ORDER_LATE";

export interface RecipientRule { roles: string[]; rep: boolean; assignees: boolean; important?: boolean }

/** حالات استثنائية: إشعار مهم يصل أيضًا للمدير العام والمكلّفين بمهام مفتوحة */
export const ALERT_STATUSES: OrderStatus[] = ["ON_HOLD", "CANCELLED", "NEEDS_REVISION", "RETURNED", "REWORK"];

export const EVENT_RULES: Record<OrderEventKind, RecipientRule> = {
  ORDER_NEW: { roles: ["SUPER_ADMIN", "OPERATIONS_MANAGER", "SALES_SUPERVISOR"], rep: true, assignees: false },
  ORDER_STATUS_CHANGED: { roles: ["OPERATIONS_MANAGER", "SALES_SUPERVISOR"], rep: true, assignees: false },
  DEPOSIT_RECEIVED: { roles: ["OPERATIONS_MANAGER"], rep: true, assignees: false },
  ORDER_REP_CHANGED: { roles: ["OPERATIONS_MANAGER"], rep: true, assignees: false },
  ORDER_DUE_CHANGED: { roles: ["OPERATIONS_MANAGER", "SALES_SUPERVISOR"], rep: true, assignees: true },
  ORDER_COMMENT: { roles: [], rep: true, assignees: true },
  DUE_SOON: { roles: ["OPERATIONS_MANAGER", "SALES_SUPERVISOR"], rep: true, assignees: true, important: true },
  ORDER_LATE: { roles: ["SUPER_ADMIN", "OPERATIONS_MANAGER", "SALES_SUPERVISOR"], rep: true, assignees: true, important: true },
};

/** قاعدة إشعار تغيير الحالة حسب الحالة الجديدة */
export function statusChangeRule(to: OrderStatus): RecipientRule {
  const base = EVENT_RULES.ORDER_STATUS_CHANGED;
  return ALERT_STATUSES.includes(to) ? { roles: [...base.roles, "SUPER_ADMIN"], rep: true, assignees: true, important: true } : base;
}

/** نص مختصر لجسم الإشعار (120 حرفًا كحد أقصى) */
export function cutText(t?: string | null, max = 120) {
  const r = t?.trim();
  return r ? (r.length > max ? `${r.slice(0, max - 1)}…` : r) : undefined;
}

/** نص إشعار تغيير الحالة: «الطلب GP-…: قديم ← جديد» والسبب مقصوصًا عند 120 حرفًا */
export function statusChangeText(number: string, fromLabel: string, toLabel: string, reason?: string | null) {
  return { title: `الطلب ${number}: ${fromLabel} ← ${toLabel}`, body: cutText(reason) };
}

/** يجمع مستلمي حدث: أعضاء الأدوار + المندوب + المكلّفين، بلا تكرار وبلا المنفّذ والمستثنين */
export function planRecipients(i: {
  rule: RecipientRule; repId: string; assigneeIds: string[]; roleMembers: { id: string; roles: string[] }[];
  extra?: (string | null | undefined)[]; exclude?: (string | null | undefined)[];
}): string[] {
  const ids = new Set<string>();
  for (const u of i.roleMembers) if (u.roles.some((r) => i.rule.roles.includes(r))) ids.add(u.id);
  if (i.rule.rep) ids.add(i.repId);
  if (i.rule.assignees) i.assigneeIds.forEach((x) => ids.add(x));
  (i.extra ?? []).forEach((x) => x && ids.add(x));
  (i.exclude ?? []).forEach((x) => x && ids.delete(x));
  return [...ids];
}

/** الصلاحيات الفعلية: صلاحيات الأدوار + المنح الاستثنائية − السحب (مع تجاهل المنتهية) */
export function effectivePermissions(
  rolePermissions: string[], overrides: { key: string; granted: boolean; expiresAt: Date | null }[], now = new Date(),
): Set<PermissionKey> {
  const perms = new Set(rolePermissions as PermissionKey[]);
  for (const o of overrides) {
    if (o.expiresAt && o.expiresAt < now) continue;
    if (o.granted) perms.add(o.key as PermissionKey); else perms.delete(o.key as PermissionKey);
  }
  return perms;
}

/** إشعار طلبٍ ما يصل فقط لمن يحق له رؤية الطلب (موظف المبيعات: طلباته فقط) */
export function mayReceiveOrderNotification(u: { id: string; permissions: Set<PermissionKey> }, order: { salesRepId: string }) {
  return u.permissions.has("orders.view_all") || u.id === order.salesRepId;
}

import { db, type DB, type Tx } from "@/lib/db";
import { effectivePermissions, mayReceiveOrderNotification, planRecipients, type RecipientRule } from "@/lib/notification-rules";
import type { Actor } from "../actor";

type Client = DB | Tx;
const json = (v: unknown) => (v === undefined || v === null ? undefined : JSON.parse(JSON.stringify(v)));

export async function audit(c: Client, actorId: string | null, action: string, entity?: string, entityId?: string, before?: unknown, after?: unknown) {
  await c.auditLog.create({ data: { actorId, action, entity, entityId, before: json(before), after: json(after) } });
}

/** حدث في السجل الزمني للطلب (إلحاقي فقط) */
export async function timeline(c: Client, orderId: string, actor: Actor | null, type: string, message: string, data?: unknown) {
  await c.orderEvent.create({ data: { orderId, actorId: actor?.id ?? null, type, message, data: json(data) } });
}

export interface NotifyOpts {
  roles?: string[]; userIds?: (string | null | undefined)[]; type: string; title: string; body?: string; link?: string; important?: boolean;
  /** الطلب المرتبط: يُستخدم لتصفية المستلمين حسب نطاق الطلبات ولمنع التكرار داخل المعاملة */
  orderId?: string;
  /** منفّذ الإجراء: لا يُشعَر بفعله هو */
  actorId?: string | null;
  /** إشعار عام (تغيير الحالة): يُتجاهل لمن وصله إشعار أخص عن نفس الطلب في نفس المعاملة */
  generic?: boolean;
}

/** إشعارات أُنشئت داخل كل معاملة: الطلب → المستخدم → {الإشعار، عام؟} */
const sentInTx = new WeakMap<object, Map<string, Map<string, { id: string; generic: boolean }>>>();

/**
 * إشعار داخلي: أعضاء الأدوار + مستخدمون محددون، مستخدم واحد مرة واحدة، دون المنفّذ ودون المعطّلين.
 * إشعار مرتبط بطلب لا يصل لموظف مبيعات إلا إن كان مندوب هذا الطلب.
 */
export async function notify(c: Client, opts: NotifyOpts) {
  const ids = new Set((opts.userIds ?? []).filter((x): x is string => !!x));
  if (opts.roles?.length) {
    const members = await c.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: opts.roles } } } } }, select: { id: true } });
    members.forEach((u) => ids.add(u.id));
  }
  if (opts.actorId) ids.delete(opts.actorId);
  if (!ids.size) return [];

  const users = await c.user.findMany({
    where: { id: { in: [...ids] }, isActive: true },
    select: {
      id: true,
      roles: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
      permissionOverrides: { select: { granted: true, expiresAt: true, permission: { select: { key: true } } } },
    },
  });
  const order = opts.orderId ? await c.order.findUnique({ where: { id: opts.orderId }, select: { salesRepId: true } }) : null;
  let recipients = users
    .map((u) => ({
      id: u.id,
      permissions: effectivePermissions(
        u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)),
        u.permissionOverrides.map((o) => ({ key: o.permission.key, granted: o.granted, expiresAt: o.expiresAt })),
      ),
    }))
    .filter((u) => !order || mayReceiveOrderNotification(u, order))
    .map((u) => u.id);

  // منع التكرار داخل المعاملة نفسها: الإشعار الأخص يغلب إشعار تغيير الحالة العام
  const reg = opts.orderId && c !== db ? (sentInTx.get(c) ?? sentInTx.set(c, new Map()).get(c)!) : null;
  const seen = reg ? (reg.get(opts.orderId!) ?? reg.set(opts.orderId!, new Map()).get(opts.orderId!)!) : null;
  if (seen) {
    if (opts.generic) recipients = recipients.filter((u) => !seen.has(u));
    else {
      const replace = recipients.map((u) => seen.get(u)).filter((x) => x?.generic).map((x) => x!.id);
      if (replace.length) await c.notification.deleteMany({ where: { id: { in: replace } } });
    }
  }
  if (!recipients.length) return [];
  const rows = await c.notification.createManyAndReturn({
    data: recipients.map((userId) => ({
      userId, type: opts.type, title: opts.title, body: opts.body, link: opts.link, orderId: opts.orderId, isImportant: !!opts.important,
    })),
    select: { id: true, userId: true },
  });
  if (seen) for (const r of rows) seen.set(r.userId, { id: r.id, generic: !!opts.generic });
  return rows;
}

/** المكلّفون بمهام مفتوحة على الطلب: مصممو مهام التصميم المفتوحة وموظفو أوامر التشغيل ومراحلها المفتوحة */
export async function orderAssignees(c: Client, orderId: string) {
  const [designs, prods] = await Promise.all([
    c.designTask.findMany({ where: { orderId, status: { notIn: ["APPROVED", "CANCELLED"] }, assigneeId: { not: null } }, select: { assigneeId: true } }),
    c.productionOrder.findMany({
      where: { orderId, status: { in: ["PLANNED", "SCHEDULED", "IN_PROGRESS", "PAUSED"] } },
      select: { assigneeId: true, stages: { where: { status: { in: ["PENDING", "IN_PROGRESS"] } }, select: { assigneeId: true } } },
    }),
  ]);
  const ids = new Set<string>();
  designs.forEach((d) => d.assigneeId && ids.add(d.assigneeId));
  prods.forEach((p) => { if (p.assigneeId) ids.add(p.assigneeId); p.stages.forEach((s) => s.assigneeId && ids.add(s.assigneeId)); });
  return [...ids];
}

/** مستلمو حدث على طلب حسب القاعدة: الأدوار + المندوب + المكلّفون، مع إضافات واستثناءات */
export async function recipientsForOrder(
  c: Client, order: { id: string; salesRepId: string },
  opts: { roles: string[]; includeRep: boolean; includeAssignees: boolean; extra?: (string | null | undefined)[]; exclude?: (string | null | undefined)[] },
) {
  const rule: RecipientRule = { roles: opts.roles, rep: opts.includeRep, assignees: opts.includeAssignees };
  const [assigneeIds, members] = await Promise.all([
    opts.includeAssignees ? orderAssignees(c, order.id) : Promise.resolve([]),
    opts.roles.length
      ? c.user.findMany({ where: { isActive: true, roles: { some: { role: { key: { in: opts.roles } } } } }, select: { id: true, roles: { select: { role: { select: { key: true } } } } } })
      : Promise.resolve([]),
  ]);
  return planRecipients({
    rule, repId: order.salesRepId, assigneeIds, extra: opts.extra, exclude: opts.exclude,
    roleMembers: members.map((m) => ({ id: m.id, roles: m.roles.map((r) => r.role.key) })),
  });
}

/** يرسل إشعار حدث طلب وفق قاعدته */
export async function notifyOrderEvent(
  c: Client, actor: Actor | null, order: { id: string; number: string; salesRepId: string }, rule: RecipientRule,
  msg: { type: string; title: string; body?: string; important?: boolean; generic?: boolean; extra?: (string | null | undefined)[] },
) {
  const userIds = await recipientsForOrder(c, order, { roles: rule.roles, includeRep: rule.rep, includeAssignees: rule.assignees, extra: msg.extra, exclude: [actor?.id] });
  return notify(c, {
    userIds, type: msg.type, title: msg.title, body: msg.body, link: `/orders/${order.id}`, orderId: order.id,
    important: msg.important ?? rule.important, actorId: actor?.id, generic: msg.generic,
  });
}

/** ترقيم تلقائي ذري: GP-2026-0001 */
export async function nextNumber(c: Client, prefix: string, pad = 4) {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const r = await c.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return `${prefix}-${year}-${String(r.value).padStart(pad, "0")}`;
}

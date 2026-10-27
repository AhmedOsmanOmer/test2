/**
 * فحوصات دورية (تُستدعى كل 15 دقيقة من cron أو systemd timer):
 * - قرب موعد التسليم (خلال 24 ساعة) — إشعار واحد لكل طلب يوميًا
 * - تأخر الطلب — تحديث مؤشر isLate وإشعار عند أول اكتشاف
 * آمنة للتكرار: لا تُنشئ إشعارًا مكررًا لنفس الحدث في نفس اليوم.
 */
import { db } from "@/lib/db";
import { FINISHED } from "@/lib/order-flow";
import { ORDER_STATUS } from "@/lib/labels";
import { EVENT_RULES } from "@/lib/notification-rules";
import { notifyOrderEvent, timeline } from "./audit";

async function sentToday(type: string, link: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return (await db.notification.count({ where: { type, link, createdAt: { gte: start } } })) > 0;
}

export async function runScheduledChecks(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const result = { dueSoon: 0, newlyLate: 0 };

  for (const o of await db.order.findMany({ where: { dueDate: { gt: now, lte: soon }, status: { notIn: FINISHED } }, select: { id: true, number: true, salesRepId: true } })) {
    const link = `/orders/${o.id}`;
    if (await sentToday("DUE_SOON", link)) continue;
    await notifyOrderEvent(db, null, o, EVENT_RULES.DUE_SOON, { type: "DUE_SOON", title: `قرب موعد تسليم الطلب ${o.number} (خلال 24 ساعة)` });
    result.dueSoon++;
  }

  const late = await db.order.findMany({ where: { dueDate: { lte: now }, status: { notIn: FINISHED }, isLate: false }, select: { id: true, number: true, salesRepId: true, status: true } });
  for (const o of late) {
    await db.order.update({ where: { id: o.id }, data: { isLate: true } });
    await timeline(db, o.id, null, "ORDER_LATE", `تجاوز الطلب موعد التسليم وهو في مرحلة «${ORDER_STATUS[o.status]}»`);
    await notifyOrderEvent(db, null, o, EVENT_RULES.ORDER_LATE, { type: "ORDER_LATE", title: `تأخر الطلب ${o.number}` });
    result.newlyLate++;
  }
  // تصحيح المؤشر للطلبات التي انتهت أو عُدِّل موعدها
  await db.order.updateMany({ where: { isLate: true, OR: [{ status: { in: FINISHED } }, { dueDate: { gt: now } }] }, data: { isLate: false } });

  return result;
}

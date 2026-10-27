import Link from "next/link";
import { requireActor } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Empty, Badge } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { markNotificationsReadAction, markNotificationReadAction } from "@/server/actions";
import { dateTime } from "@/lib/format";

export default async function Notifications({ searchParams }: { searchParams: { important?: string } }) {
  const a = await requireActor();
  const list = await db.notification.findMany({ where: { userId: a.id, ...(searchParams.important ? { isImportant: true } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title="الإشعارات" actions={<>
        <Link href="/notifications" className={!searchParams.important ? "btn-primary" : "btn-ghost"}>الكل</Link>
        <Link href="/notifications?important=1" className={searchParams.important ? "btn-primary" : "btn-ghost"}>المهمة</Link>
        <ActionButton action={markNotificationsReadAction}>تعليم الكل كمقروء</ActionButton>
      </>} />
      <Card>{list.length ? <ul className="divide-y divide-paper-line">{list.map((x) => (
        <li key={x.id} className={`flex items-start justify-between gap-4 py-3 ${x.readAt ? "opacity-60" : ""}`}>
          {/* <a> وليس Link: الفتح يعلّم الإشعار كمقروء، فلا يجوز أن يُجلب مسبقًا */}
          <div><div className="flex items-center gap-2 text-sm font-medium">{!x.readAt && <span className="h-2 w-2 rounded-full bg-cyan-process" />}<a href={`/notifications/${x.id}/open`} className="hover:text-cyan-deep">{x.title}</a>{x.isImportant && <Badge tone="red">مهم</Badge>}</div>
            {x.body && <p className="text-sm text-ink-soft">{x.body}</p>}</div>
          <span className="flex shrink-0 items-start gap-3">
            {!x.readAt && <ActionButton className="text-xs text-cyan-deep" action={markNotificationReadAction.bind(null, x.id)}>تعليم كمقروء</ActionButton>}
            <span className="whitespace-nowrap text-xs text-ink-faint">{dateTime(x.createdAt)}</span>
          </span>
        </li>))}</ul> : <Empty title="لا توجد إشعارات" />}</Card>
    </>
  );
}

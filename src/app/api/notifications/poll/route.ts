import { NextResponse } from "next/server";
import { currentActor } from "@/server/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const select = { id: true, title: true, body: true, link: true, isImportant: true, readAt: true, createdAt: true } as const;

/**
 * استطلاع إشعارات المستخدم الحالي فقط: عدد غير المقروء، والجديد بعد آخر معرّف معروف (20 كحد أقصى)،
 * أو آخر 10 إشعارات إن لم يُرسل `after`. يعتمد على الفهرس (userId, readAt, createdAt).
 */
export async function GET(req: Request) {
  const a = await currentActor();
  if (!a) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const after = new URL(req.url).searchParams.get("after");
  const anchor = after ? await db.notification.findFirst({ where: { id: after, userId: a.id }, select: { id: true, createdAt: true } }) : null;
  const [unread, items, latest] = await Promise.all([
    db.notification.count({ where: { userId: a.id, readAt: null } }),
    anchor
      ? db.notification.findMany({
          where: { userId: a.id, OR: [{ createdAt: { gt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { gt: anchor.id } }] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select,
        })
      : db.notification.findMany({ where: { userId: a.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10, select }),
    db.notification.findFirst({ where: { userId: a.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }),
  ]);
  return NextResponse.json({ unread, items, latestId: latest?.id ?? null, fresh: !!anchor }, { headers: NO_STORE });
}

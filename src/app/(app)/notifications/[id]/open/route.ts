import { NextResponse } from "next/server";
import { currentActor } from "@/server/auth";
import { db } from "@/lib/db";
import { safeInternalPath } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

/** فتح إشعار (F18): يعلّم إشعار المستخدم نفسه فقط كمقروء ثم يحوّل لرابطه الداخلي */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const a = await currentActor();
  if (!a) return NextResponse.redirect(new URL("/login", req.url));
  const n = await db.notification.findFirst({ where: { id: params.id, userId: a.id }, select: { id: true, link: true, readAt: true } });
  if (!n) return NextResponse.redirect(new URL("/notifications", req.url));
  if (!n.readAt) await db.notification.updateMany({ where: { id: n.id, userId: a.id, readAt: null }, data: { readAt: new Date() } });
  // مسار نسبي إلى أصل الطلب نفسه، فلا يمكن أن يخرج لنطاق آخر
  const target = new URL(safeInternalPath(n.link), req.url);
  return NextResponse.redirect(target.origin === new URL(req.url).origin ? target : new URL("/notifications", req.url));
}

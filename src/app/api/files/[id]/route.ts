import { NextResponse } from "next/server";
import { currentActor } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { readStored } from "@/server/services/files";
import { inOrderScope } from "@/lib/order-access";

export const dynamic = "force-dynamic";

/** تنزيل محمي: لا روابط عامة للملفات؛ كل طلب يتحقق من الجلسة والصلاحية ونطاق الطلب المرتبط بالملف */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await currentActor();
  if (!a) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const f = await db.attachment.findUnique({ where: { id: params.id }, include: { order: { select: { salesRepId: true } } } });
  if (!f || !can(a, "files.view") || (f.order && !inOrderScope(a, f.order))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readStored(f.storageKey).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "missing" }, { status: 404 });
  const inline = ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.mimeType);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": f.mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.originalName)}`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

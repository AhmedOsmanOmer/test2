import { NextResponse } from "next/server";
import { currentActor } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { buildItemsTemplate } from "@/server/import/items-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** قالب Excel لاستيراد بنود الطلب */
export async function GET() {
  const a = await currentActor();
  if (!a) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(a, "orders.import_items")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const cats = await db.productCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } });
  const buf = await buildItemsTemplate(cats.map((c) => c.name));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="order-items-template.xlsx"; filename*=UTF-8''${encodeURIComponent("قالب-بنود-الطلب.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}

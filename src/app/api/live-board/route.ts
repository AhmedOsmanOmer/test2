import { NextResponse } from "next/server";
import { getBoardData } from "@/server/services/liveboard";
import { boardAccess } from "./auth";

export const dynamic = "force-dynamic";

/** واجهة بيانات تشغيلية فقط — لا أسعار ولا مبالغ ولا بيانات تواصل */
export async function GET(req: Request) {
  const acc = await boardAccess(req);
  if (!acc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await getBoardData(acc.config);
  return NextResponse.json({ config: acc.config, name: acc.name, data }, { headers: { "Cache-Control": "no-store" } });
}

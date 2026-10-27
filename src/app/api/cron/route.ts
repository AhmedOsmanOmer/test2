import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runScheduledChecks } from "@/server/services/scheduler";

export const dynamic = "force-dynamic";

/** يُستدعى من cron على الخادم نفسه: curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (secret.length < 24 || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runScheduledChecks());
}

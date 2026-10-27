import { NextResponse } from "next/server";
import { currentActor } from "@/server/auth";
import { AppError } from "@/lib/errors";
import { IMPORT_LIMITS } from "@/lib/order-item-import";
import { isSameOrigin, rateLimit } from "@/server/request-guards";
import { previewOrderImport, previewNewOrderImport } from "@/server/services/item-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * معاينة استيراد بنود من Excel (multipart: file، orderId اختياري).
 * مع orderId: سجل معاينة للتأكيد لاحقًا. بدونه: البنود المتحقق منها لتعبئة نموذج «طلب جديد».
 */
export async function POST(req: Request) {
  const a = await currentActor();
  if (!a) return json({ error: "انتهت الجلسة، سجّل الدخول مجددًا" }, 401);
  if (!isSameOrigin(req)) return json({ error: "طلب غير مسموح" }, 403);
  if (!rateLimit(`import:${a.id}`, 10, 60_000)) return json({ error: "محاولات رفع كثيرة. انتظر دقيقة ثم أعد المحاولة." }, 429);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > IMPORT_LIMITS.maxBytes + 64 * 1024) return json({ error: "حجم الملف يتجاوز 5 ميجابايت" }, 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "طلب غير صالح" }, 400); }
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return json({ error: "اختر ملف Excel" }, 400);
  if (f.size > IMPORT_LIMITS.maxBytes) return json({ error: "حجم الملف يتجاوز 5 ميجابايت" }, 413);
  const orderId = form.get("orderId");
  try {
    const file = { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) };
    const r = typeof orderId === "string" && orderId ? await previewOrderImport(a, orderId, file) : await previewNewOrderImport(a, file);
    return json(r);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400);
    console.error("[import-error]", e instanceof Error ? e.name : "unknown");
    return json({ error: "تعذّرت معالجة الملف. حاول مرة أخرى." }, 500);
  }
}

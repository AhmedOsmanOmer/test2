import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentActor } from "@/server/auth";
import { AppError, zodMessage } from "@/lib/errors";
import { PROOF_LIMITS } from "@/lib/delivery-proof";
import { isSameOrigin, rateLimit } from "@/server/request-guards";
import { createDelivery } from "@/server/services/delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * تسليم مع صور الإثبات في طلب واحد (multipart): payload (JSON لبيانات التسليم) + photos (1-5 صور).
 * الخدمة نفسها تفرض الصور والتحقق منها؛ ولا يُحفظ شيء إن كان أي ملف غير صالح.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await currentActor();
  if (!a) return json({ error: "انتهت الجلسة، سجّل الدخول مجددًا" }, 401);
  if (!isSameOrigin(req)) return json({ error: "طلب غير مسموح" }, 403);
  if (!rateLimit(`delivery:${a.id}`, 20, 60_000)) return json({ error: "محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة." }, 429);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > PROOF_LIMITS.max * PROOF_LIMITS.maxBytes + 1024 * 1024) return json({ error: "حجم الصور أكبر من المسموح" }, 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "طلب غير صالح" }, 400); }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(String(form.get("payload") ?? "{}")); } catch { return json({ error: "بيانات التسليم غير صالحة" }, 400); }
  const files = form.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
  if (files.length > PROOF_LIMITS.max) return json({ error: `الحد الأقصى ${PROOF_LIMITS.max} صور لإثبات التسليم` }, 400);
  if (files.some((f) => f.size > PROOF_LIMITS.maxBytes)) return json({ error: "إحدى الصور أكبر من 8 ميجابايت" }, 413);
  try {
    const photos = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })));
    const dn = await createDelivery(a, { ...payload, orderId: params.id } as never, photos);
    revalidatePath(`/orders/${params.id}`); revalidatePath("/delivery");
    return json({ id: dn.id, number: dn.number, isFinal: dn.isFinal });
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400);
    if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError") return json({ error: zodMessage(e as never) }, 400);
    console.error("[delivery-error]", e instanceof Error ? e.name : "unknown");
    return json({ error: "تعذّر حفظ التسليم. حاول مرة أخرى." }, 500);
  }
}

import "server-only";

/** طلب من نفس الأصل فقط (حماية CSRF لمسارات الرفع): Origin يطابق المضيف، أو Sec-Fetch-Site = same-origin */
export function isSameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) return site === "same-origin";
  try { return new URL(origin).host === host; } catch { return false; }
}

/** حد بسيط في الذاكرة: N طلبات لكل مستخدم في نافذة زمنية (لكل عملية خادم) */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return true;
}

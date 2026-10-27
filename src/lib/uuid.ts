/**
 * معرّف UUID v4 آمن للاستخدام في المتصفح حتى على http://<عنوان الشبكة>:
 * crypto.randomUUID متاح في السياقات الآمنة فقط (HTTPS أو localhost)، بينما getRandomValues متاح دائمًا.
 */
export function uuid(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    try { return c.randomUUID(); } catch { /* سياق غير آمن: نكمل بالبديل */ }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // الإصدار 4
  b[8] = (b[8] & 0x3f) | 0x80; // النوع RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

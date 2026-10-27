/**
 * التحقق من صور إثبات التسليم — منطق نقي: نوع الملف من محتواه (Magic bytes) لا من الامتداد أو نوع MIME المرسل.
 * المقبول: JPEG وPNG وWebP. HEIC/HEIF يُرفض برسالة واضحة (المتصفح يحوّل الصورة إلى JPEG قبل الرفع عادة).
 */
export const PROOF_LIMITS = { min: 1, max: 5, maxBytes: 8 * 1024 * 1024 } as const;

export type ProofType = { ext: "jpg" | "png" | "webp"; mime: "image/jpeg" | "image/png" | "image/webp" };
export interface ProofInput { name: string; bytes: Uint8Array }

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** نوع الصورة من محتواها، أو heic، أو null لغير الصور */
export function sniffImage(b: Uint8Array): ProofType | "heic" | null {
  if (b.length < 12) return null;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", mime: "image/png" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (ascii(b, 4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|avif)$/.test(ascii(b, 8, 4))) return "heic";
  return null;
}

/** يتحقق من كل الصور؛ أي ملف غير صالح يرفض الطلب كله برسالة عربية */
export function validateProofPhotos(files: ProofInput[]): { ok: true; types: ProofType[] } | { ok: false; error: string } {
  if (files.length < PROOF_LIMITS.min) return { ok: false, error: "أرفق صورة إثبات تسليم واحدة على الأقل" };
  if (files.length > PROOF_LIMITS.max) return { ok: false, error: `الحد الأقصى ${PROOF_LIMITS.max} صور لإثبات التسليم` };
  const types: ProofType[] = [];
  for (const [i, f] of files.entries()) {
    const n = `الصورة ${i + 1}`;
    if (!f.bytes.length) return { ok: false, error: `${n} فارغة` };
    if (f.bytes.length > PROOF_LIMITS.maxBytes) return { ok: false, error: `${n} أكبر من 8 ميجابايت` };
    const t = sniffImage(f.bytes);
    if (t === "heic") return { ok: false, error: `${n} بصيغة HEIC غير مدعومة. التقطها من زر الكاميرا في الصفحة، أو اختر في إعدادات الكاميرا «الأكثر توافقًا» (JPEG).` };
    if (!t) return { ok: false, error: `${n} ليست صورة صالحة (المسموح JPEG أو PNG أو WebP)` };
    types.push(t);
  }
  return { ok: true, types };
}

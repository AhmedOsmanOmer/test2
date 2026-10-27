import { describe, it, expect } from "vitest";
import { validateProofPhotos, sniffImage, PROOF_LIMITS } from "@/lib/delivery-proof";
import { testProofPhoto } from "../scripts/test-photo";

const png = () => ({ name: "a.png", bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]) });
const webp = () => ({ name: "a.webp", bytes: Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(40)]) });
const heic = () => ({ name: "IMG_1.HEIC", bytes: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(40)]) });
const err = (r: ReturnType<typeof validateProofPhotos>) => (r.ok ? null : r.error);

describe("التحقق من صور إثبات التسليم", () => {
  it("يقبل JPEG وPNG وWebP حسب المحتوى", () => {
    const r = validateProofPhotos([testProofPhoto(), png(), webp()]);
    expect(r.ok && r.types.map((t) => t.ext)).toEqual(["jpg", "png", "webp"]);
  });
  it("بلا صور: مرفوض", () => {
    expect(err(validateProofPhotos([]))).toBe("أرفق صورة إثبات تسليم واحدة على الأقل");
  });
  it("أكثر من 5 صور: مرفوض", () => {
    expect(err(validateProofPhotos(Array.from({ length: PROOF_LIMITS.max + 1 }, (_, i) => testProofPhoto(i))))).toBe("الحد الأقصى 5 صور لإثبات التسليم");
  });
  it("امتداد صورة مزيف لملف ليس صورة: مرفوض (لا نثق بالامتداد)", () => {
    expect(err(validateProofPhotos([testProofPhoto(), { name: "photo.jpg", bytes: Buffer.from("MZ\x90\x00 this is an executable, not an image") }])))
      .toBe("الصورة 2 ليست صورة صالحة (المسموح JPEG أو PNG أو WebP)");
    expect(err(validateProofPhotos([{ name: "x.png", bytes: Buffer.from("%PDF-1.7 some pdf content here") }]))).toMatch(/ليست صورة صالحة/);
  });
  it("نوع غير مسموح (GIF وSVG) مرفوض", () => {
    expect(err(validateProofPhotos([{ name: "a.gif", bytes: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00") }]))).toMatch(/ليست صورة صالحة/);
    expect(err(validateProofPhotos([{ name: "a.svg", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }]))).toMatch(/ليست صورة صالحة/);
  });
  it("HEIC: رسالة واضحة", () => {
    expect(sniffImage(heic().bytes)).toBe("heic");
    expect(err(validateProofPhotos([heic()]))).toMatch(/HEIC غير مدعومة/);
  });
  it("أكبر من 8 ميجابايت أو فارغة: مرفوض", () => {
    const big = Buffer.concat([testProofPhoto().bytes, Buffer.alloc(PROOF_LIMITS.maxBytes)]);
    expect(err(validateProofPhotos([{ name: "big.jpg", bytes: big }]))).toBe("الصورة 1 أكبر من 8 ميجابايت");
    expect(err(validateProofPhotos([{ name: "e.jpg", bytes: Buffer.alloc(0) }]))).toBe("الصورة 1 فارغة");
  });
});

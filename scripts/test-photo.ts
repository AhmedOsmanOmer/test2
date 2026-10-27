/** صورة JPEG صغيرة صالحة لاختبارات وسكربتات التسليم (إثبات التسليم إلزامي) — للاختبار فقط */
import { randomBytes } from "crypto";

// JPEG بحجم 1×1 بكسل
const TINY_JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

/** صورة إثبات تجريبية؛ ذيل عشوائي بعد نهاية الصورة يجعل بصمة كل نسخة مختلفة */
export function testProofPhoto(n = 1) {
  return { name: `proof-${n}.jpg`, bytes: Buffer.concat([Buffer.from(TINY_JPEG, "base64"), Buffer.from([0xff, 0xd9]), randomBytes(8)]) };
}

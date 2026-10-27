/**
 * تصغير صورة في المتصفح قبل الرفع: الضلع الأطول ≤ 1600 بكسل وإعادة ترميز JPEG بجودة ~0.8.
 * يحترم اتجاه الكاميرا (EXIF) ويُسقط بيانات EXIF/الموقع لأن الرسم على canvas لا ينقلها. بلا مكتبات.
 */
export async function resizeToJpeg(file: Blob, maxSide = 1600, quality = 0.8): Promise<Blob> {
  let src: CanvasImageSource & { width: number; height: number };
  let cleanup = () => {};
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    src = bmp; cleanup = () => bmp.close();
  } catch {
    // متصفحات بلا createImageBitmap لهذه الصيغة: عنصر img (يطبّق الاتجاه تلقائيًا في المتصفحات الحديثة)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("تعذّرت قراءة الصورة. إن كانت بصيغة HEIC التقطها من زر الكاميرا مباشرة أو اختر صيغة JPEG.");
    }
    cleanup = () => URL.revokeObjectURL(url);
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("تعذّرت معالجة الصورة على هذا الجهاز");
    ctx.drawImage(src, 0, 0, w, h);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!out) throw new Error("تعذّرت معالجة الصورة على هذا الجهاز");
    return out;
  } finally {
    cleanup();
  }
}

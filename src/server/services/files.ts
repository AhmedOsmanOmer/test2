import { createHash, randomBytes } from "crypto";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import type { Tx, DB } from "@/lib/db";
import { rule } from "@/lib/errors";
import type { AttachmentKind } from "@/generated/prisma/enums";
import type { Actor } from "../actor";
import uploadLimit from "@/lib/upload-limit.json";
const { uploadMaxMb } = uploadLimit;

const ALLOWED: Record<string, string> = {
  ai: "application/postscript", psd: "image/vnd.adobe.photoshop", pdf: "application/pdf", svg: "image/svg+xml",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", tif: "image/tiff", tiff: "image/tiff", eps: "application/postscript",
  webp: "image/webp", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const MAX_BYTES = uploadMaxMb * 1024 * 1024;
const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage");

export interface UploadInput { name: string; bytes: Buffer }

/** يحفظ الملف خارج مجلد public باسم عشوائي ويُسجله في قاعدة البيانات مع الإصدار */
export async function storeFile(
  c: Tx | DB, actor: Actor, file: UploadInput, kind: AttachmentKind,
  link: { orderId?: string; orderItemId?: string; customerId?: string; designVersionId?: string; groupKey?: string },
) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED[ext]) throw rule(`نوع الملف .${ext} غير مسموح`);
  if (file.bytes.length === 0) throw rule("الملف فارغ");
  if (file.bytes.length > MAX_BYTES) throw rule(`حجم الملف يتجاوز ${uploadMaxMb} ميجابايت`);
  const now = new Date();
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${randomBytes(16).toString("hex")}.${ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, file.bytes, { mode: 0o640 });
  const groupKey = link.groupKey ?? `${link.orderId ?? link.customerId ?? "misc"}:${file.name.toLowerCase()}`;
  const prev = await c.attachment.count({ where: { groupKey } });
  const { groupKey: _g, ...rel } = link;
  return c.attachment.create({
    data: {
      kind, originalName: file.name.slice(0, 250), storageKey: key, mimeType: ALLOWED[ext], sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"), groupKey, versionNo: prev + 1,
      uploadedById: actor.id, ...rel,
    },
  });
}

/** يكتب ملفًا في مجلد التخزين الخاص باسم عشوائي (بلا سجل) — للعمليات التي تسجّل الملفات داخل معاملة لاحقًا */
export async function writeStoredFile(bytes: Uint8Array, ext: string) {
  const now = new Date();
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${randomBytes(16).toString("hex")}.${ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { mode: 0o640 });
  return key;
}

/** حذف ملف مخزن (تنظيف بعد فشل معاملة، أو حذف إداري موثق) */
export async function removeStoredFile(storageKey: string) {
  const full = path.resolve(root(), storageKey);
  if (!full.startsWith(root() + path.sep)) return;
  await unlink(full).catch(() => undefined);
}

export async function readStored(storageKey: string) {
  const full = path.resolve(root(), storageKey);
  if (!full.startsWith(root() + path.sep)) throw rule("مسار غير صالح");
  return readFile(full);
}

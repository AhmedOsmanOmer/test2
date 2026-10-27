/**
 * استيراد بنود الطلب من Excel: معاينة ثم تأكيد.
 * - الملف لا يُحفظ: فقط البصمة والاسم والحجم، والبنود المتحقق منها في OrderItemImport.
 * - كل شيء أو لا شيء: أي خطأ في أي صف يمنع الاستيراد.
 * - التأكيد يقرأ البنود من القاعدة (لا من المتصفح)، ويعيد فحص الصلاحية والنطاق والحالة، ولا يكرر عند التأكيد مرتين.
 * - لا مبالغ في أي نتيجة أو حدث أو إشعار (لا أعمدة مالية أصلًا).
 */
import { db, type Tx } from "@/lib/db";
import { notFound, rule, AppError } from "@/lib/errors";
import { idx, EXCEPTION } from "@/lib/order-flow";
import { IMPORT_LIMITS, type RowError } from "@/lib/order-item-import";
import type { ItemData } from "@/lib/order-item";
import type { OrderStatus } from "@/generated/prisma/enums";
import { requirePerm, type Actor } from "../actor";
import { audit, notify, timeline } from "./audit";
import { assertOrderAccess } from "./access";
import { parseOrderItemsFile, type ParsedRow } from "../import/order-items-xlsx";

const PREVIEW_TTL_MS = 24 * 3600_000;
const BLOCKED: OrderStatus[] = ["CANCELLED", "CLOSED", "DELIVERED", "RETURNED", "ON_HOLD"];
export const ADD_ITEMS_BLOCKED_MSG = "لا يمكن إضافة بنود بعد بدء الإنتاج";

export interface ImportWarning { row: number; message: string }
export interface ImportPreview {
  importId: string | null; fileName: string; totalRows: number; validRows: ParsedRow[]; errors: RowError[]; warnings: ImportWarning[];
  duplicateFile: boolean; canConfirm: boolean; fileError?: string;
}

/** إضافة البنود مسموحة قبل «تحت الإنتاج» فقط، وليس في الحالات الموقوفة أو المنتهية */
async function assertCanAddItems(c: Tx | typeof db, orderId: string) {
  const o = await c.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  if (BLOCKED.includes(o.status)) throw rule(ADD_ITEMS_BLOCKED_MSG);
  let base = o.status;
  if (EXCEPTION.includes(o.status)) {
    const last = await c.orderStatusHistory.findFirst({ where: { orderId, toStatus: { notIn: EXCEPTION } }, orderBy: { createdAt: "desc" }, select: { toStatus: true } });
    if (!last) throw rule(ADD_ITEMS_BLOCKED_MSG);
    base = last.toStatus;
  }
  if (idx(base) < 0 || idx(base) >= idx("IN_PRODUCTION")) throw rule(ADD_ITEMS_BLOCKED_MSG);
}

/** للواجهة: هل يمكن إضافة بنود لهذا الطلب الآن؟ */
export async function canAddItems(orderId: string) {
  try { await assertCanAddItems(db, orderId); return true; } catch { return false; }
}

const key = (i: { name: string; quantity: number; material?: string | null; printType?: string | null; colors?: string | null; length?: unknown; width?: unknown; height?: unknown }) =>
  [i.name, i.quantity, i.material ?? "", i.printType ?? "", i.colors ?? "", Number(i.length ?? 0), Number(i.width ?? 0), Number(i.height ?? 0)].map((x) => String(x).trim().toLowerCase()).join("|");

async function categories() {
  return db.productCategory.findMany({ where: { isActive: true }, select: { id: true, name: true } });
}

/** تنتهي المعاينات الأقدم من 24 ساعة */
export async function expireOldPreviews(now = new Date()) {
  await db.orderItemImport.updateMany({ where: { status: "PREVIEW", createdAt: { lt: new Date(now.getTime() - PREVIEW_TTL_MS) } }, data: { status: "EXPIRED" } });
}

/** معاينة استيراد إلى طلب قائم: يحلل ويتحقق ويحفظ سجل معاينة (بلا الملف) */
export async function previewOrderImport(actor: Actor, orderId: string, file: { name: string; bytes: Buffer }): Promise<ImportPreview> {
  requirePerm(actor, "orders.import_items");
  await assertOrderAccess(actor, orderId);
  await assertCanAddItems(db, orderId);
  await expireOldPreviews();
  const p = await parseOrderItemsFile(file.name, file.bytes, await categories());
  const base = { fileName: file.name.slice(0, 200), totalRows: p.totalRows, validRows: p.rows, errors: p.errors };
  if (p.fileError) return { ...base, importId: null, warnings: [], duplicateFile: false, canConfirm: false, fileError: p.fileError };

  const existing = await db.orderItem.findMany({ where: { orderId }, select: { name: true, quantity: true, material: true, printType: true, colors: true, length: true, width: true, height: true } });
  const errors = [...p.errors];
  if (existing.length + p.rows.length > IMPORT_LIMITS.maxItemsPerOrder)
    errors.push({ row: 0, column: "", value: "", message: `عدد بنود الطلب سيتجاوز الحد الأقصى (${IMPORT_LIMITS.maxItemsPerOrder} بند)` });
  const known = new Map(existing.map((e) => [key(e), e.name]));
  const warnings = p.rows.filter((r) => known.has(key(r.data))).map((r) => ({ row: r.row, message: `مطابق لبند موجود في الطلب «${known.get(key(r.data))}»` }));
  const duplicateFile = !!(await db.orderItemImport.findFirst({ where: { orderId, fileSha256: p.sha256, status: "COMMITTED" }, select: { id: true } }));
  const rec = await db.orderItemImport.create({
    data: {
      orderId, fileName: base.fileName, fileSha256: p.sha256, sizeBytes: p.sizeBytes, status: "PREVIEW",
      rows: p.rows as never, errors: errors as never, totalRows: p.totalRows, uploadedById: actor.id,
    },
  });
  return { ...base, errors, importId: rec.id, warnings, duplicateFile, canConfirm: errors.length === 0 && p.rows.length > 0 };
}

/** معاينة لنموذج «طلب جديد»: يعيد البنود المتحقق منها فقط (بلا سجل في القاعدة) */
export async function previewNewOrderImport(actor: Actor, file: { name: string; bytes: Buffer }): Promise<ImportPreview> {
  requirePerm(actor, "orders.create");
  requirePerm(actor, "orders.import_items");
  const p = await parseOrderItemsFile(file.name, file.bytes, await categories());
  const errors = [...p.errors];
  if (p.rows.length > IMPORT_LIMITS.maxItemsPerOrder) errors.push({ row: 0, column: "", value: "", message: `الحد الأقصى ${IMPORT_LIMITS.maxItemsPerOrder} بند للطلب` });
  return {
    importId: null, fileName: file.name.slice(0, 200), totalRows: p.totalRows, validRows: p.rows, errors, warnings: [], duplicateFile: false,
    canConfirm: !p.fileError && errors.length === 0 && p.rows.length > 0, fileError: p.fileError,
  };
}

/** تأكيد الاستيراد: معاملة واحدة، والتأكيد الثاني لا يكرر البنود */
export async function confirmOrderImport(actor: Actor, importId: string, opts: { acceptDuplicateFile?: boolean } = {}) {
  requirePerm(actor, "orders.import_items");
  const imp = await db.orderItemImport.findUnique({ where: { id: importId } });
  if (!imp || !imp.orderId || imp.uploadedById !== actor.id) throw notFound("المعاينة غير موجودة");
  await assertOrderAccess(actor, imp.orderId);
  if (imp.status === "COMMITTED") throw rule("تم استيراد هذا الملف مسبقًا");
  if (imp.status !== "PREVIEW") throw rule("انتهت صلاحية المعاينة أو أُلغيت. ارفع الملف من جديد.");
  if (Date.now() - imp.createdAt.getTime() > PREVIEW_TTL_MS) {
    await db.orderItemImport.updateMany({ where: { id: imp.id, status: "PREVIEW" }, data: { status: "EXPIRED" } });
    throw rule("انتهت صلاحية المعاينة (24 ساعة). ارفع الملف من جديد.");
  }
  if ((imp.errors as unknown as RowError[]).length) throw rule("الملف يحتوي أخطاء؛ صححها وارفعه من جديد");
  const rows = imp.rows as unknown as ParsedRow[];
  if (!rows.length) throw rule("لا توجد بنود للاستيراد");
  const orderId = imp.orderId;
  const dup = await db.orderItemImport.findFirst({ where: { orderId, fileSha256: imp.fileSha256, status: "COMMITTED" }, select: { id: true } });
  if (dup && !opts.acceptDuplicateFile) throw rule("هذا الملف نفسه استُورد سابقًا لهذا الطلب. أكّد رغبتك في استيراده مرة أخرى.");

  return db.$transaction(async (tx) => {
    // الانتقال PREVIEW → COMMITTED شرطي: التأكيد المتزامن أو المكرر لا ينجح إلا مرة واحدة
    const claimed = await tx.orderItemImport.updateMany({ where: { id: imp.id, status: "PREVIEW" }, data: { status: "COMMITTED", committedAt: new Date() } });
    if (claimed.count === 0) throw rule("تم استيراد هذا الملف مسبقًا");
    await assertCanAddItems(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, number: true, salesRepId: true, version: true } });
    const count = await tx.orderItem.count({ where: { orderId } });
    if (count + rows.length > IMPORT_LIMITS.maxItemsPerOrder) throw rule(`عدد بنود الطلب سيتجاوز الحد الأقصى (${IMPORT_LIMITS.maxItemsPerOrder} بند)`);
    const last = await tx.orderItem.aggregate({ where: { orderId }, _max: { sortOrder: true } });
    let sort = (last._max.sortOrder ?? -1) + 1;
    await tx.orderItem.createMany({
      data: rows.map(({ data }) => {
        const { categoryId, ...rest } = data as ItemData;
        return { ...rest, orderId, categoryId: categoryId || undefined, sortOrder: sort++ };
      }),
    });
    const bumped = await tx.order.updateMany({ where: { id: orderId, version: order.version }, data: { version: { increment: 1 } } });
    if (bumped.count === 0) throw new AppError("تم تعديل الطلب من مستخدم آخر. أعد المحاولة.", "CONFLICT");
    const n = rows.length;
    await timeline(tx, orderId, actor, "ITEMS_IMPORTED", `تم استيراد ${n} بنداً من ملف Excel`, { importId: imp.id });
    await audit(tx, actor.id, "IMPORT_ORDER_ITEMS", "Order", orderId, null, { importId: imp.id, orderId, count: n, fileSha256: imp.fileSha256 });
    if (order.salesRepId !== actor.id)
      await notify(tx, { userIds: [order.salesRepId], type: "ITEMS_IMPORTED", title: `تم استيراد ${n} بنداً من Excel إلى الطلب ${order.number}`, link: `/orders/${orderId}?tab=items`, orderId, actorId: actor.id });
    return { count: n, orderId };
  });
}

/** إلغاء معاينة لم تُؤكد */
export async function cancelOrderImport(actor: Actor, importId: string) {
  requirePerm(actor, "orders.import_items");
  const r = await db.orderItemImport.updateMany({ where: { id: importId, uploadedById: actor.id, status: "PREVIEW" }, data: { status: "CANCELLED" } });
  if (r.count === 0) throw notFound("المعاينة غير موجودة");
}

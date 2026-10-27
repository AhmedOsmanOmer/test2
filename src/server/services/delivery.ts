import { z } from "zod";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { notFound, rule, forbidden } from "@/lib/errors";
import { validateProofPhotos, type ProofInput } from "@/lib/delivery-proof";
import { requirePerm, type Actor } from "../actor";
import { writeStoredFile, removeStoredFile } from "./files";
import { audit, nextNumber, timeline, notify } from "./audit";
import { tryAdvance, transitionTx } from "./orders";
import { assertOrderAccess } from "./access";

export const deliverySchema = z.object({
  orderId: z.string(),
  method: z.enum(["PICKUP", "COURIER", "SHIPPING_COMPANY", "THIRD_PARTY"]),
  address: z.string().trim().max(500).optional(),
  handlerId: z.string().optional(),
  recipientName: z.string().trim().min(2, "اسم المستلم مطلوب"),
  recipientPhone: z.string().trim().max(20).optional(),
  signatureData: z.string().max(200_000).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(z.object({ orderItemId: z.string(), quantity: z.coerce.number().int().min(0) })).min(1),
  idempotencyKey: z.string().min(8),
});

const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

/**
 * تسليم (جزئي أو كامل) مع إصدار سند تسليم — صورة إثبات واحدة على الأقل وحتى 5 صور إلزامية لكل تسليم.
 * التحقق من الصور قبل أي كتابة؛ والتسليم وسجلات الصور في معاملة واحدة، ولو فشلت تُحذف الملفات المكتوبة.
 * الإرسال المكرر (نفس idempotencyKey) يعيد التسليم نفسه بلا تكرار.
 */
export async function createDelivery(actor: Actor, input: z.input<typeof deliverySchema>, photos: ProofInput[]) {
  requirePerm(actor, "delivery.manage");
  const d = deliverySchema.parse(input);
  const dup = await db.delivery.findUnique({ where: { idempotencyKey: d.idempotencyKey } });
  if (dup) return dup;
  const lines = d.items.filter((i) => i.quantity > 0);
  if (!lines.length) throw rule("أدخل كمية لمنتج واحد على الأقل");
  await assertOrderAccess(actor, d.orderId);
  const check = validateProofPhotos(photos ?? []);
  if (!check.ok) throw rule(check.error);

  const keys: string[] = [];
  try {
    for (const [i, f] of photos.entries()) keys.push(await writeStoredFile(f.bytes, check.types[i].ext));
    return await db.$transaction(async (tx) => {
      const o = await tx.order.findUnique({ where: { id: d.orderId }, include: { items: true } });
      if (!o) throw notFound();
      if (!["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"].includes(o.status)) throw rule("الطلب ليس جاهزًا للتسليم");
      for (const l of lines) {
        const it = o.items.find((x) => x.id === l.orderItemId);
        if (!it) throw rule("منتج غير موجود في الطلب");
        const ready = it.approvedQty - it.deliveredQty;
        const open = it.quantity - it.cancelledQty - it.deliveredQty;
        if (l.quantity > Math.min(ready, open)) throw rule(`الكمية الجاهزة للتسليم من «${it.name}» ${Math.min(ready, open)} فقط`);
      }
      const number = await nextNumber(tx, "DN");
      // الكمية المعتمدة قد تزيد عن المطلوبة؛ لا نسلّم أكثر من المطلوب
      let allDone = true;
      for (const it of o.items) {
        const l = lines.find((x) => x.orderItemId === it.id);
        const delivered = it.deliveredQty + (l?.quantity ?? 0);
        if (delivered + it.cancelledQty < it.quantity) allDone = false;
        if (l) await tx.orderItem.update({ where: { id: it.id }, data: { deliveredQty: delivered, status: delivered + it.cancelledQty >= it.quantity ? "DELIVERED" : "PARTIALLY_DELIVERED" } });
      }
      const { items: _i, idempotencyKey, ...rest } = d;
      const dn = await tx.delivery.create({
        data: { ...rest, number, idempotencyKey, handlerId: d.handlerId ?? actor.id, status: "DELIVERED", deliveredAt: new Date(), isFinal: allDone,
          items: { create: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })) } },
      });
      // صور الإثبات: وقت الخادم والمستخدم الحالي فقط، باسم مولّد (لا يُعتمد اسم الملف المرسل)
      const proofs = [];
      for (const [i, f] of photos.entries()) {
        const t = check.types[i];
        proofs.push(await tx.attachment.create({
          data: {
            kind: "DELIVERY_PROOF", originalName: `إثبات-تسليم-${number}-${i + 1}.${t.ext}`, storageKey: keys[i], mimeType: t.mime, sizeBytes: f.bytes.length,
            sha256: createHash("sha256").update(f.bytes).digest("hex"), groupKey: `delivery-proof:${dn.id}:${i + 1}`, versionNo: 1,
            orderId: o.id, deliveryId: dn.id, uploadedById: actor.id,
          },
          select: { id: true, sha256: true },
        }));
      }
      const summary = lines.map((l) => `${l.quantity} ${o.items.find((x) => x.id === l.orderItemId)!.name}`).join("، ");
      await timeline(tx, o.id, actor, "DELIVERY", `${allDone ? "تسليم نهائي" : "تسليم جزئي"} بسند ${number} إلى ${d.recipientName}: ${summary}`);
      await timeline(tx, o.id, actor, "DELIVERY_PROOF", allDone ? `تم تسليم الطلب مع ${proofs.length} صورة إثبات` : `تم تسليم جزء من الطلب مع ${proofs.length} صورة إثبات`, { deliveryId: dn.id });
      await audit(tx, actor.id, "DELIVERY_CREATE", "Delivery", dn.id, null, { number, lines, final: allDone });
      await audit(tx, actor.id, "DELIVERY_PROOF_CREATE", "Delivery", dn.id, null, { orderId: o.id, deliveryId: dn.id, count: proofs.length, attachmentIds: proofs.map((p) => p.id), sha256: proofs.map((p) => p.sha256) });
      if (allDone) {
        if (o.status === "READY_FOR_DELIVERY") await transitionTx(tx, actor, o.id, "OUT_FOR_DELIVERY", { system: true });
        await tryAdvance(tx, actor, o.id, "DELIVERED", ["OUT_FOR_DELIVERY", "READY_FOR_DELIVERY"]);
        await notify(tx, { roles: ["SALES_SUPERVISOR"], userIds: [o.salesRepId], type: "ORDER_DELIVERED", title: `تم تسليم الطلب ${o.number} بالكامل`, link: `/orders/${o.id}`, orderId: o.id, actorId: actor.id });
      } else await tryAdvance(tx, actor, o.id, "OUT_FOR_DELIVERY", ["READY_FOR_DELIVERY"]);
      return dn;
    });
  } catch (e) {
    await Promise.all(keys.map(removeStoredFile)); // لا ملفات يتيمة عند الفشل
    if (isUniqueViolation(e)) {
      const existing = await db.delivery.findUnique({ where: { idempotencyKey: d.idempotencyKey } });
      if (existing) return existing; // إرسال متزامن مكرر
    }
    throw e;
  }
}

/** حذف صورة إثبات — للمدير العام فقط وبسبب إلزامي، مع سجل تدقيق وحدث في السجل الزمني */
export async function deleteDeliveryProof(actor: Actor, attachmentId: string, reason: string) {
  if (!actor.roles.includes("SUPER_ADMIN")) throw forbidden("حذف صور إثبات التسليم للمدير العام فقط");
  if (!reason?.trim()) throw rule("اذكر سبب حذف صورة الإثبات");
  const f = await db.attachment.findUnique({ where: { id: attachmentId } });
  if (!f || f.kind !== "DELIVERY_PROOF" || !f.orderId) throw notFound("الصورة غير موجودة");
  const r = reason.trim().slice(0, 500);
  await db.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: f.id } });
    await timeline(tx, f.orderId!, actor, "DELIVERY_PROOF_DELETED", "تم حذف صورة إثبات تسليم", { reason: r });
    await audit(tx, actor.id, "DELIVERY_PROOF_DELETE", "Attachment", f.id, { deliveryId: f.deliveryId, orderId: f.orderId, sha256: f.sha256, uploadedById: f.uploadedById, createdAt: f.createdAt }, { reason: r });
  });
  await removeStoredFile(f.storageKey);
}

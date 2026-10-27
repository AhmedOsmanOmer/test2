import { z } from "zod";
import { db } from "@/lib/db";
import { notFound, rule } from "@/lib/errors";
import { requirePerm, type Actor } from "../actor";
import { audit, nextNumber, timeline, notify } from "./audit";
import { tryAdvance, flowContext } from "./orders";
import { createProductionOrderTx } from "./production";

export const QC_CHECKS = {
  dimensions: "مطابقة المقاسات", colors: "مطابقة الألوان", printQuality: "جودة الطباعة", materials: "جودة الخامات",
  finishing: "سلامة التشطيب", packaging: "سلامة التغليف", quantity: "مطابقة الكمية",
} as const;

export const inspectionSchema = z.object({
  productionOrderId: z.string(),
  acceptedQty: z.coerce.number().int().min(0),
  rejectedQty: z.coerce.number().int().min(0),
  checks: z.record(z.enum(Object.keys(QC_CHECKS) as [keyof typeof QC_CHECKS]), z.boolean()),
  result: z.enum(["ACCEPTED", "ACCEPTED_WITH_NOTES", "REJECTED", "REWORK"]),
  rejectReason: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** فحص الجودة — عند الرفض يُنشأ أمر إعادة إنتاج ومهمة تصحيحية مرتبطان بالأمر الأصلي */
export async function inspect(actor: Actor, input: z.input<typeof inspectionSchema>) {
  requirePerm(actor, "quality.inspect");
  const d = inspectionSchema.parse(input);
  const failed = d.result === "REJECTED" || d.result === "REWORK";
  if (failed && !d.rejectReason) throw rule("سبب الرفض مطلوب");
  if (d.result === "ACCEPTED_WITH_NOTES" && !d.notes) throw rule("اكتب الملاحظات");
  return db.$transaction(async (tx) => {
    const po = await tx.productionOrder.findUnique({ where: { id: d.productionOrderId }, include: { orderItem: true, order: true, stages: true } });
    if (!po) throw notFound();
    if (po.status !== "QC_PENDING") throw rule("أمر التشغيل ليس بانتظار الفحص");
    if (d.acceptedQty + d.rejectedQty !== po.completedQty) throw rule(`مجموع المقبول والمرفوض يجب أن يساوي المنتج (${po.completedQty})`);
    if (failed && d.rejectedQty === 0) throw rule("حدد الكمية المرفوضة");
    const ins = await tx.qualityInspection.create({
      data: { productionOrderId: po.id, inspectedQty: po.completedQty, acceptedQty: d.acceptedQty, rejectedQty: d.rejectedQty, checks: d.checks, result: d.result, rejectReason: d.rejectReason, notes: d.notes, inspectorId: actor.id },
    });
    await tx.productionOrder.update({ where: { id: po.id }, data: { status: failed ? "QC_FAILED" : "QC_PASSED" } });
    await tx.orderItem.update({ where: { id: po.orderItemId }, data: { approvedQty: { increment: d.acceptedQty } } });
    await audit(tx, actor.id, "QC_INSPECT", "ProductionOrder", po.id, null, { result: d.result, accepted: d.acceptedQty, rejected: d.rejectedQty });

    if (failed) {
      const rework = await createProductionOrderTx(tx, actor, {
        orderId: po.orderId, orderItemId: po.orderItemId, quantity: d.rejectedQty, machineId: po.machineId ?? undefined,
        assigneeId: po.assigneeId ?? undefined, priority: "HIGH", stages: po.stages.sort((a, b) => a.sequence - b.sequence).map((s) => s.name),
        parentId: po.id, notes: `إعادة إنتاج بعد رفض الجودة: ${d.rejectReason}`,
      });
      const tn = await nextNumber(tx, "TK");
      await tx.task.create({
        data: { number: tn, orderId: po.orderId, department: "PRODUCTION", title: `إجراء تصحيحي — ${po.number}`, description: d.rejectReason,
          priority: "HIGH", assigneeId: po.assigneeId, creatorId: actor.id, sourceType: "QC_REJECT", sourceId: ins.id },
      });
      await timeline(tx, po.orderId, actor, "QC_REJECTED", `رفض الجودة ${d.rejectedQty} من ${po.number}: ${d.rejectReason} — أمر إعادة إنتاج ${rework.number}`);
      await notify(tx, { roles: ["PRODUCTION_SUPERVISOR", "OPERATIONS_MANAGER"], type: "QC_REJECTED", title: `رفض جودة ${po.number}`, body: d.rejectReason, link: `/production/${rework.id}`, important: true, orderId: po.orderId, actorId: actor.id });
      await tryAdvance(tx, actor, po.orderId, "REWORK", ["QUALITY_CHECK", "IN_PRODUCTION", "FINISHING_PACKAGING"]).catch(() => false);
    } else {
      await timeline(tx, po.orderId, actor, "QC_PASSED", `اعتماد الجودة لـ ${po.number}: ${d.acceptedQty} مقبول${d.notes ? ` — ${d.notes}` : ""}`);
      const { ctx } = await flowContext(tx, po.orderId);
      const allPassed = ctx.productionOrders.every((p) => p.status === "QC_PASSED" || p.status === "CANCELLED");
      if (allPassed) {
        await tx.orderItem.updateMany({ where: { orderId: po.orderId, status: { in: ["IN_PRODUCTION", "QC", "REWORK"] } }, data: { status: "READY" } });
        await tryAdvance(tx, actor, po.orderId, "READY_FOR_DELIVERY", ["QUALITY_CHECK", "REWORK", "IN_PRODUCTION", "FINISHING_PACKAGING"]);
      }
    }
    return ins;
  });
}

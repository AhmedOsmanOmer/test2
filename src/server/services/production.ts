import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { notFound, rule, forbidden } from "@/lib/errors";
import { round2 } from "@/lib/format";
import { idx } from "@/lib/order-flow";
import { requirePerm, can, type Actor } from "../actor";
import { audit, nextNumber, timeline, notify } from "./audit";
import { tryAdvance } from "./orders";
import { assertOrderAccess } from "./access";

export const DEFAULT_STAGES = ["تجهيز الملفات", "تجهيز الخامات", "الطباعة", "القص", "التشكيل", "التجميع", "التغليف", "الفحص النهائي"];

export const productionSchema = z.object({
  orderId: z.string(), orderItemId: z.string(),
  quantity: z.coerce.number().int().positive(),
  machineId: z.string().optional(), assigneeId: z.string().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  plannedStart: z.coerce.date().optional(), plannedEnd: z.coerce.date().optional(),
  stages: z.array(z.string().trim().min(1)).min(1, "اختر مرحلة واحدة على الأقل"),
  notes: z.string().trim().max(2000).optional(),
  parentId: z.string().optional(),
});
export type ProductionInput = z.input<typeof productionSchema>;

/** ينشئ أمر تشغيل (أو دفعة إنتاج) */
export async function createProductionOrderTx(tx: Tx, actor: Actor, input: ProductionInput) {
  const d = productionSchema.parse(input);
  await assertOrderAccess(actor, d.orderId, tx);
  const order = await tx.order.findUnique({ where: { id: d.orderId } });
  if (!order) throw notFound("الطلب غير موجود");
  const item = await tx.orderItem.findFirst({ where: { id: d.orderItemId, orderId: order.id } });
  if (!item) throw notFound("المنتج غير موجود في الطلب");
  if (!d.parentId && idx(order.status) < idx("MATERIALS_PREP") && order.status !== "REWORK")
    throw rule("لا يمكن إنشاء أمر تشغيل قبل اعتماد التصميم وتأكيد استلام الدفعة المقدمة");
  if (!d.parentId) {
    const planned = await tx.productionOrder.aggregate({ where: { orderItemId: item.id, parentId: null, status: { not: "CANCELLED" } }, _sum: { quantity: true } });
    const left = item.quantity - item.cancelledQty - (planned._sum.quantity ?? 0);
    if (d.quantity > left) throw rule(`الكمية المتبقية للجدولة لهذا المنتج ${left}`);
  }
  if (d.plannedStart && d.plannedEnd && d.plannedEnd <= d.plannedStart) throw rule("وقت الانتهاء يجب أن يكون بعد البداية");
  if (d.machineId && d.plannedStart && d.plannedEnd) {
    const clash = await tx.productionOrder.findFirst({
      where: { machineId: d.machineId, status: { in: ["SCHEDULED", "IN_PROGRESS", "PAUSED"] }, plannedStart: { lt: d.plannedEnd }, plannedEnd: { gt: d.plannedStart } },
      select: { number: true },
    });
    if (clash) throw rule(`تعارض تشغيلي: الآلة محجوزة لأمر التشغيل ${clash.number} في نفس الفترة`);
  }
  const batches = await tx.productionOrder.count({ where: { orderItemId: item.id } });
  const number = await nextNumber(tx, "PR");
  const po = await tx.productionOrder.create({
    data: {
      number, orderId: order.id, orderItemId: item.id, batchNo: batches + 1, quantity: d.quantity, machineId: d.machineId,
      assigneeId: d.assigneeId, priority: d.priority ?? order.priority, status: d.plannedStart ? "SCHEDULED" : "PLANNED",
      plannedStart: d.plannedStart, plannedEnd: d.plannedEnd, notes: d.notes, parentId: d.parentId,
      stages: { create: d.stages.map((name, k) => ({ name, sequence: k + 1, machineId: d.machineId, assigneeId: d.assigneeId })) },
    },
  });
  await tx.orderItem.update({ where: { id: item.id }, data: { status: "IN_PRODUCTION" } });
  await timeline(tx, order.id, actor, "PRODUCTION_ORDER_CREATED", `إنشاء أمر التشغيل ${number} لـ «${item.name}» بكمية ${d.quantity}${d.parentId ? " (إعادة إنتاج)" : ""}`);
  if (d.assigneeId) await notify(tx, { userIds: [d.assigneeId], type: "TASK_NEW", title: `أمر تشغيل جديد ${number}`, link: `/production/${po.id}`, important: po.priority === "URGENT", orderId: order.id, actorId: actor.id });
  await tryAdvance(tx, actor, order.id, "PRODUCTION_SCHEDULED", ["MATERIALS_PREP"]);
  return po;
}

export async function createProductionOrder(actor: Actor, input: ProductionInput) {
  requirePerm(actor, "production.manage");
  return db.$transaction((tx) => createProductionOrderTx(tx, actor, input));
}

async function loadPO(tx: Tx, id: string, actor: Actor) {
  const po = await tx.productionOrder.findUnique({ where: { id }, include: { stages: { orderBy: { sequence: "asc" } }, orderItem: true, order: true } });
  if (!po) throw notFound("أمر التشغيل غير موجود");
  const mine = po.assigneeId === actor.id || po.stages.some((s) => s.assigneeId === actor.id);
  if (!can(actor, "production.manage") && !(can(actor, "production.work") && mine)) throw forbidden("أمر التشغيل غير مسند إليك");
  return po;
}

export async function startProduction(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    const po = await loadPO(tx, id, actor);
    if (!["PLANNED", "SCHEDULED", "PAUSED"].includes(po.status)) throw rule("لا يمكن بدء أمر التشغيل في حالته الحالية");
    if (po.machineId) {
      const m = await tx.machine.findUniqueOrThrow({ where: { id: po.machineId } });
      if (["MAINTENANCE", "STOPPED"].includes(m.status)) throw rule(`الآلة «${m.name}» ${m.status === "MAINTENANCE" ? "تحت الصيانة" : "متوقفة"}`);
      await tx.machine.update({ where: { id: m.id }, data: { status: "RUNNING" } });
    }
    await tx.productionOrder.update({ where: { id }, data: { status: "IN_PROGRESS", actualStart: po.actualStart ?? new Date() } });
    const first = po.stages.find((s) => s.status === "PENDING" || s.status === "IN_PROGRESS");
    if (first && first.status === "PENDING") await tx.productionStage.update({ where: { id: first.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await timeline(tx, po.orderId, actor, "PRODUCTION_STARTED", `بدأ الإنتاج لأمر التشغيل ${po.number}${first ? ` — مرحلة ${first.name}` : ""}`);
    await notify(tx, { roles: ["PRODUCTION_SUPERVISOR"], userIds: [po.order.salesRepId], type: "PRODUCTION_STARTED", title: `بدء الإنتاج ${po.number}`, link: `/production/${po.id}`, orderId: po.orderId, actorId: actor.id });
    await tryAdvance(tx, actor, po.orderId, "IN_PRODUCTION", ["PRODUCTION_SCHEDULED", "MATERIALS_PREP", "REWORK"]);
  });
}

export async function pauseProduction(actor: Actor, id: string, reason: string) {
  if (!reason.trim()) throw rule("سبب الإيقاف مطلوب");
  return db.$transaction(async (tx) => {
    const po = await loadPO(tx, id, actor);
    if (po.status !== "IN_PROGRESS") throw rule("أمر التشغيل ليس قيد التنفيذ");
    await tx.productionOrder.update({ where: { id }, data: { status: "PAUSED", notes: [po.notes, `إيقاف: ${reason}`].filter(Boolean).join("\n") } });
    if (po.machineId) await tx.machine.update({ where: { id: po.machineId }, data: { status: "AVAILABLE" } });
    await timeline(tx, po.orderId, actor, "PRODUCTION_PAUSED", `إيقاف ${po.number}: ${reason}`);
  });
}

/** إنهاء المرحلة الحالية وبدء التالية */
export async function completeStage(actor: Actor, stageId: string) {
  return db.$transaction(async (tx) => {
    const st = await tx.productionStage.findUnique({ where: { id: stageId } });
    if (!st) throw notFound();
    const po = await loadPO(tx, st.productionOrderId, actor);
    if (po.status !== "IN_PROGRESS") throw rule("ابدأ أمر التشغيل أولًا");
    if (st.status === "DONE") throw rule("المرحلة منتهية مسبقًا");
    await tx.productionStage.update({ where: { id: st.id }, data: { status: "DONE", completedAt: new Date(), startedAt: st.startedAt ?? new Date() } });
    const next = po.stages.find((s) => s.sequence > st.sequence && s.status === "PENDING");
    if (next) await tx.productionStage.update({ where: { id: next.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await timeline(tx, po.orderId, actor, "STAGE_DONE", `اكتمال مرحلة «${st.name}» في ${po.number}${next ? ` — بدء «${next.name}»` : ""}`);
    if (next && /تغليف|تشطيب/.test(next.name)) await tryAdvance(tx, actor, po.orderId, "FINISHING_PACKAGING", ["IN_PRODUCTION"]);
  });
}

/** تسجيل الكمية المنجزة والتالفة — مفتاح idempotency يمنع التكرار عند إعادة الإرسال */
export async function logProgress(actor: Actor, i: { productionOrderId: string; goodQty: number; scrapQty: number; scrapReason?: string; note?: string; idempotencyKey: string }) {
  const good = Math.trunc(i.goodQty), scrap = Math.trunc(i.scrapQty);
  if (good < 0 || scrap < 0 || good + scrap === 0) throw rule("أدخل كمية منجزة أو تالفة");
  if (scrap > 0 && !i.scrapReason?.trim()) throw rule("سبب التالف مطلوب");
  const dup = await db.productionLog.findUnique({ where: { idempotencyKey: i.idempotencyKey } });
  if (dup) return dup;
  return db.$transaction(async (tx) => {
    const po = await loadPO(tx, i.productionOrderId, actor);
    if (po.status !== "IN_PROGRESS") throw rule("أمر التشغيل ليس قيد التنفيذ");
    if (po.completedQty + good > po.quantity) throw rule(`الكمية المنجزة تتجاوز المطلوب (${po.quantity - po.completedQty} متبقية)`);
    const stage = po.stages.find((s) => s.status === "IN_PROGRESS");
    const log = await tx.productionLog.create({ data: { productionOrderId: po.id, stageId: stage?.id, goodQty: good, scrapQty: scrap, scrapReason: i.scrapReason, note: i.note, userId: actor.id, idempotencyKey: i.idempotencyKey } });
    const completed = po.completedQty + good;
    await tx.productionOrder.update({ where: { id: po.id }, data: { completedQty: completed, scrapQty: { increment: scrap }, progressPct: Math.min(100, Math.round((completed / po.quantity) * 100)) } });
    await tx.orderItem.update({ where: { id: po.orderItemId }, data: { producedQty: { increment: good } } });
    await timeline(tx, po.orderId, actor, "PRODUCTION_PROGRESS", `${po.number}: منجز ${good}${scrap ? `، تالف ${scrap} (${i.scrapReason})` : ""} — الإجمالي ${completed}/${po.quantity}`);
    return log;
  });
}

/** إنهاء أمر التشغيل وإرساله للجودة */
export async function completeProduction(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    const po = await loadPO(tx, id, actor);
    if (po.status !== "IN_PROGRESS") throw rule("أمر التشغيل ليس قيد التنفيذ");
    if (po.completedQty <= 0) throw rule("سجّل الكمية المنجزة قبل الإنهاء");
    await tx.productionStage.updateMany({ where: { productionOrderId: id, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: "DONE", completedAt: new Date() } });
    await tx.productionOrder.update({ where: { id }, data: { status: po.order.requiresQC ? "QC_PENDING" : "QC_PASSED", actualEnd: new Date(), progressPct: 100 } });
    if (po.machineId) {
      const hours = po.actualStart ? (Date.now() - po.actualStart.getTime()) / 3600_000 : 0;
      await tx.machine.update({ where: { id: po.machineId }, data: { status: "AVAILABLE", runningHours: { increment: round2(hours) } } });
    }
    if (!po.order.requiresQC) await tx.orderItem.update({ where: { id: po.orderItemId }, data: { approvedQty: { increment: po.completedQty } } });
    await timeline(tx, po.orderId, actor, "PRODUCTION_COMPLETED", `اكتمال إنتاج ${po.number}: ${po.completedQty} منجز، ${po.scrapQty} تالف`);
    await notify(tx, { roles: ["QUALITY"], type: "PRODUCTION_DONE", title: `اكتمال الإنتاج — بانتظار الفحص ${po.number}`, link: `/quality`, orderId: po.orderId, actorId: actor.id });
    const open = await tx.productionOrder.count({ where: { orderId: po.orderId, status: { in: ["PLANNED", "SCHEDULED", "IN_PROGRESS", "PAUSED"] } } });
    if (open === 0) {
      if (po.order.requiresQC) await tryAdvance(tx, actor, po.orderId, "QUALITY_CHECK", ["IN_PRODUCTION", "FINISHING_PACKAGING", "REWORK"]);
      else await tryAdvance(tx, actor, po.orderId, "READY_FOR_DELIVERY", ["IN_PRODUCTION", "FINISHING_PACKAGING"]);
    }
  });
}

// ---------------- الآلات ----------------
export async function setMachineStatus(actor: Actor, machineId: string, status: "AVAILABLE" | "STOPPED" | "MAINTENANCE", note: string) {
  requirePerm(actor, "machines.manage");
  if (status !== "AVAILABLE" && !note.trim()) throw rule("اذكر سبب الإيقاف أو الصيانة");
  return db.$transaction(async (tx) => {
    const m = await tx.machine.findUnique({ where: { id: machineId } });
    if (!m) throw notFound();
    await tx.machine.update({ where: { id: m.id }, data: { status } });
    if (status !== "AVAILABLE") {
      await tx.machineMaintenance.create({ data: { machineId: m.id, kind: status === "MAINTENANCE" ? "صيانة" : "عطل/توقف", description: note.trim(), startedAt: new Date(), recordedById: actor.id } });
      // إيقاف الأوامر الجارية على الآلة وإبلاغ المسؤولين
      const running = await tx.productionOrder.findMany({ where: { machineId: m.id, status: "IN_PROGRESS" }, select: { id: true, number: true, orderId: true } });
      for (const p of running) {
        await tx.productionOrder.update({ where: { id: p.id }, data: { status: "PAUSED" } });
        await timeline(tx, p.orderId, actor, "MACHINE_DOWN", `توقف ${p.number} بسبب ${status === "MAINTENANCE" ? "صيانة" : "عطل"} الآلة «${m.name}»: ${note}`);
      }
      await notify(tx, { roles: ["PRODUCTION_SUPERVISOR", "OPERATIONS_MANAGER"], type: "MACHINE_DOWN", title: `تعطل/صيانة الآلة ${m.name}`, body: note, link: "/production/machines", important: true, actorId: actor.id });
    } else {
      await tx.machineMaintenance.updateMany({ where: { machineId: m.id, endedAt: null }, data: { endedAt: new Date() } });
    }
    await audit(tx, actor.id, "MACHINE_STATUS", "Machine", m.id, { status: m.status }, { status, note });
  });
}

export async function upsertMachine(actor: Actor, i: { id?: string; code: string; name: string; type: string; capacityPerHour?: number; capacityUnit?: string; responsibleId?: string; showOnBoard: boolean }) {
  requirePerm(actor, "machines.manage");
  if (!i.code.trim() || !i.name.trim() || !i.type.trim()) throw rule("الرمز والاسم والنوع مطلوبة");
  const data = { code: i.code.trim(), name: i.name.trim(), type: i.type.trim(), capacityPerHour: i.capacityPerHour || null, capacityUnit: i.capacityUnit || null, responsibleId: i.responsibleId || null, showOnBoard: i.showOnBoard };
  const m = i.id ? await db.machine.update({ where: { id: i.id }, data }) : await db.machine.create({ data: { ...data, branchId: actor.branchId } });
  await audit(db, actor.id, i.id ? "MACHINE_UPDATE" : "MACHINE_CREATE", "Machine", m.id, null, data);
  return m;
}

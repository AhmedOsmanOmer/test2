import { db } from "@/lib/db";
import { notFound, rule, forbidden } from "@/lib/errors";
import { requirePerm, can, type Actor } from "../actor";
import { audit, nextNumber, timeline, notify } from "./audit";
import { tryAdvance } from "./orders";
import { storeFile, type UploadInput } from "./files";
import { assertOrderAccess } from "./access";

export async function assignDesign(actor: Actor, i: { orderId: string; orderItemId?: string; assigneeId: string; dueDate?: Date; instructions?: string; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT" }) {
  requirePerm(actor, "design.assign");
  await assertOrderAccess(actor, i.orderId);
  return db.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: i.orderId } });
    if (!o) throw notFound();
    if (!o.requiresDesign) throw rule("هذا الطلب لا يتطلب تصميمًا");
    const designer = await tx.user.findFirst({ where: { id: i.assigneeId, isActive: true, roles: { some: { role: { key: "DESIGNER" } } } } });
    if (!designer) throw rule("الموظف المختار ليس مصممًا نشطًا");
    const number = await nextNumber(tx, "DS");
    const t = await tx.designTask.create({
      data: { number, orderId: o.id, orderItemId: i.orderItemId, assigneeId: designer.id, dueDate: i.dueDate, instructions: i.instructions,
        priority: i.priority ?? o.priority, assignedAt: new Date(), status: "PENDING" },
    });
    await timeline(tx, o.id, actor, "DESIGN_ASSIGNED", `تم إسناد التصميم ${number} إلى ${designer.fullName}`);
    await notify(tx, { userIds: [designer.id], type: "DESIGN_NEW", title: `مهمة تصميم جديدة ${number} — طلب ${o.number}`, link: `/design/${t.id}`, important: o.priority === "URGENT", orderId: o.id, actorId: actor.id });
    await tryAdvance(tx, actor, o.id, "IN_DESIGN", ["AWAITING_DESIGN"]);
    return t;
  });
}

async function loadTask(id: string) {
  const t = await db.designTask.findUnique({ where: { id }, include: { order: true, versions: { orderBy: { versionNo: "desc" }, take: 1 } } });
  if (!t) throw notFound("مهمة التصميم غير موجودة");
  return t;
}
const isOwnerOrManager = (a: Actor, assigneeId: string | null) => assigneeId === a.id || can(a, "design.assign");

export async function startDesign(actor: Actor, taskId: string) {
  requirePerm(actor, "design.work");
  const t = await loadTask(taskId);
  if (!isOwnerOrManager(actor, t.assigneeId)) throw forbidden("المهمة مسندة لمصمم آخر");
  await db.designTask.update({ where: { id: t.id }, data: { status: "IN_PROGRESS" } });
}

/** رفع نسخة تصميم جديدة — لا تستبدل السابقة أبدًا */
export async function uploadDesignVersion(actor: Actor, taskId: string, files: UploadInput[], notes?: string) {
  requirePerm(actor, "design.work");
  if (!files.length) throw rule("أرفق ملف تصميم واحدًا على الأقل");
  const t = await loadTask(taskId);
  if (!isOwnerOrManager(actor, t.assigneeId)) throw forbidden("المهمة مسندة لمصمم آخر");
  if (["APPROVED", "CANCELLED"].includes(t.status)) throw rule("لا يمكن رفع نسخة لمهمة معتمدة أو ملغاة");
  return db.$transaction(async (tx) => {
    const versionNo = (t.versions[0]?.versionNo ?? 0) + 1;
    const v = await tx.designVersion.create({ data: { designTaskId: t.id, versionNo, notes, uploadedById: actor.id } });
    for (const f of files) await storeFile(tx, actor, f, "DESIGN", { orderId: t.orderId, orderItemId: t.orderItemId ?? undefined, designVersionId: v.id, groupKey: `design:${t.id}:${f.name.toLowerCase()}` });
    await tx.designTask.update({ where: { id: t.id }, data: { status: "INTERNAL_REVIEW" } });
    await timeline(tx, t.orderId, actor, "DESIGN_UPLOADED", `رفع النسخة ${versionNo} من التصميم ${t.number} (${files.length} ملف)`);
    await notify(tx, { roles: ["OPERATIONS_MANAGER"], type: "DESIGN_UPLOADED", title: `نسخة تصميم جديدة للمراجعة ${t.number}`, link: `/design/${t.id}`, orderId: t.orderId, actorId: actor.id });
    await tryAdvance(tx, actor, t.orderId, "DESIGN_REVIEW", ["IN_DESIGN"]);
    return v;
  });
}

/** المراجعة الداخلية: اعتماد وإرسال للعميل، أو إعادة للمصمم */
export async function internalReview(actor: Actor, taskId: string, approve: boolean, feedback?: string) {
  requirePerm(actor, "design.approve");
  const t = await loadTask(taskId);
  const v = t.versions[0];
  if (!v || t.status !== "INTERNAL_REVIEW") throw rule("لا توجد نسخة بانتظار المراجعة الداخلية");
  if (!approve && !feedback?.trim()) throw rule("اكتب ملاحظات التعديل للمصمم");
  return db.$transaction(async (tx) => {
    await tx.designApproval.create({ data: { designTaskId: t.id, versionId: v.id, decision: approve ? "INTERNAL_APPROVED" : "INTERNAL_REJECTED", feedback, recordedById: actor.id } });
    await tx.designTask.update({ where: { id: t.id }, data: { status: approve ? "SENT_TO_CUSTOMER" : "CHANGES_REQUESTED", revisionCount: approve ? undefined : { increment: 1 } } });
    await timeline(tx, t.orderId, actor, approve ? "DESIGN_SENT" : "DESIGN_INTERNAL_REJECT",
      approve ? `اعتماد داخلي للنسخة ${v.versionNo} وإرسالها للعميل` : `إعادة النسخة ${v.versionNo} للمصمم: ${feedback}`);
    if (approve) await tryAdvance(tx, actor, t.orderId, "AWAITING_DESIGN_APPROVAL", ["DESIGN_REVIEW", "IN_DESIGN"]);
    else {
      await notify(tx, { userIds: t.assigneeId ? [t.assigneeId] : [], type: "DESIGN_CHANGES", title: `تعديل مطلوب على ${t.number}`, body: feedback, link: `/design/${t.id}`, orderId: t.orderId, actorId: actor.id });
      await tryAdvance(tx, actor, t.orderId, "IN_DESIGN", ["DESIGN_REVIEW"]);
    }
  });
}

/** تسجيل قرار العميل مع اسم المعتمد وإثبات الموافقة */
export async function recordCustomerDecision(actor: Actor, taskId: string, i: { approved: boolean; approverName: string; feedback?: string; proof?: UploadInput }) {
  requirePerm(actor, "design.approve");
  if (!i.approverName.trim()) throw rule("اسم المعتمد لدى العميل مطلوب");
  const t = await loadTask(taskId);
  const v = t.versions[0];
  if (!v || t.status !== "SENT_TO_CUSTOMER") throw rule("التصميم لم يُرسل للعميل بعد");
  if (!i.approved && !i.feedback?.trim()) throw rule("سجّل ملاحظات العميل المطلوبة");
  return db.$transaction(async (tx) => {
    const proof = i.proof ? await storeFile(tx, actor, i.proof, "APPROVAL_PROOF", { orderId: t.orderId }) : null;
    await tx.designApproval.create({
      data: { designTaskId: t.id, versionId: v.id, decision: i.approved ? "CUSTOMER_APPROVED" : "CUSTOMER_CHANGES", approverName: i.approverName, feedback: i.feedback, recordedById: actor.id, proofAttachmentId: proof?.id },
    });
    await tx.designTask.update({
      where: { id: t.id },
      data: i.approved ? { status: "APPROVED", approvedVersionId: v.id } : { status: "CHANGES_REQUESTED", revisionCount: { increment: 1 } },
    });
    if (i.approved && t.orderItemId) await tx.orderItem.update({ where: { id: t.orderItemId }, data: { status: "DESIGN_APPROVED" } });
    await timeline(tx, t.orderId, actor, i.approved ? "DESIGN_APPROVED" : "DESIGN_CUSTOMER_CHANGES",
      i.approved ? `اعتمد العميل (${i.approverName}) النسخة ${v.versionNo} من ${t.number}` : `طلب العميل (${i.approverName}) تعديلات: ${i.feedback}`);
    await audit(tx, actor.id, "DESIGN_DECISION", "DesignTask", t.id, null, { approved: i.approved, version: v.versionNo, approverName: i.approverName });
    if (i.approved) {
      await notify(tx, { roles: ["PRODUCTION_SUPERVISOR", "OPERATIONS_MANAGER"], type: "DESIGN_APPROVED", title: `اعتماد تصميم الطلب ${t.order.number}`, link: `/orders/${t.orderId}`, orderId: t.orderId, actorId: actor.id });
      await tryAdvance(tx, actor, t.orderId, "MATERIALS_PREP", ["AWAITING_DESIGN_APPROVAL", "DESIGN_REVIEW", "IN_DESIGN"]);
    } else {
      await notify(tx, { userIds: t.assigneeId ? [t.assigneeId] : [], type: "DESIGN_CHANGES", title: `تعديل من العميل على ${t.number}`, body: i.feedback, link: `/design/${t.id}`, orderId: t.orderId, actorId: actor.id });
      await tryAdvance(tx, actor, t.orderId, "IN_DESIGN", ["AWAITING_DESIGN_APPROVAL"]);
    }
  });
}

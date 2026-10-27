"use server";
/**
 * إجراءات الخادم — كل إجراء: (1) يتحقق من الجلسة (2) يستدعي الخدمة التي تتحقق من الصلاحية
 * (3) يعيد نتيجة آمنة (4) يحدّث الصفحات المتأثرة. Next.js يتحقق تلقائيًا من Origin (حماية CSRF).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, createHash } from "crypto";
import { currentActor, login, logout, hashPassword, changeOwnPassword, passwordProblem } from "./auth";
import { safe, forbidden, rule, type ActionResult } from "@/lib/errors";
import { db } from "@/lib/db";
import { requirePerm } from "./actor";
import * as customers from "./services/customers";
import * as orders from "./services/orders";
import * as design from "./services/design";
import * as prod from "./services/production";
import * as quality from "./services/quality";
import * as delivery from "./services/delivery";
import { audit } from "./services/audit";
import { assertOrderAccess } from "./services/access";
import { DEFAULT_BOARD_CONFIG, type BoardConfig } from "./services/liveboard";
import type { OrderStatus } from "@/generated/prisma/enums";

async function actor() {
  const a = await currentActor();
  if (!a) throw forbidden("انتهت الجلسة، سجّل الدخول مجددًا");
  return a;
}
const ORDER_FILE_KINDS = ["REFERENCE", "PRODUCT_PHOTO", "DESIGN", "APPROVAL_PROOF", "WORK_ORDER", "QC_REPORT", "DELIVERY_NOTE", "OTHER"];
const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined; };
async function filesOf(f: FormData, k: string) {
  const out: { name: string; bytes: Buffer }[] = [];
  for (const v of f.getAll(k)) if (v instanceof File && v.size > 0) out.push({ name: v.name, bytes: Buffer.from(await v.arrayBuffer()) });
  return out;
}

// ---------- الدخول ----------
export async function loginAction(_: unknown, f: FormData) {
  const r = await login(String(f.get("username") ?? ""), String(f.get("password") ?? ""));
  if (!r.ok) return r;
  const next = String(f.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
export async function logoutAction() { await logout(); redirect("/login"); }

// ---------- العملاء ----------
export async function createCustomerAction(_: unknown, f: FormData): Promise<ActionResult<{ id: string }>> {
  const r = await safe(async () => {
    const c = await customers.createCustomer(await actor(), Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string" && v !== "")) as never);
    return { id: c.id };
  });
  if (r.ok) redirect(`/customers/${r.data!.id}`);
  return r;
}
export async function logCommunicationAction(customerId: string, channel: string, summary: string) {
  const r = await safe(async () => { await customers.logCommunication(await actor(), customerId, channel, summary); }, "تم الحفظ");
  revalidatePath(`/customers/${customerId}`); return r;
}

// ---------- الطلبات ----------
export async function createOrderAction(input: orders.OrderInput): Promise<ActionResult<{ id: string }>> {
  return safe(async () => ({ id: (await orders.createOrder(await actor(), input)).id }), "تم إنشاء الطلب");
}
export async function changeStatusAction(orderId: string, to: OrderStatus, reason?: string, version?: number) {
  const r = await safe(async () => { await orders.changeStatus(await actor(), orderId, to, reason, version); }, "تم تحديث الحالة");
  revalidatePath("/orders"); revalidatePath(`/orders/${orderId}`); return r;
}
export async function addCommentAction(orderId: string, body: string) {
  const r = await safe(async () => { await orders.addComment(await actor(), orderId, body); });
  revalidatePath(`/orders/${orderId}`); return r;
}
export async function setOrderMoneyAction(orderId: string, input: { total?: number; paidAmount?: number; expectedVersion?: number }) {
  const r = await safe(async () => { await orders.setOrderMoney(await actor(), orderId, input); }, "تم حفظ المبالغ");
  revalidatePath("/orders"); revalidatePath(`/orders/${orderId}`); return r;
}
export async function setDepositReceivedAction(orderId: string, value: boolean, reason?: string) {
  const r = await safe(async () => { await orders.setDepositReceived(await actor(), orderId, value, reason); }, value ? "تم تأكيد استلام الدفعة المقدمة" : "تم إلغاء تأكيد الدفعة المقدمة");
  revalidatePath("/orders"); revalidatePath(`/orders/${orderId}`); return r;
}
export async function changeDueDateAction(orderId: string, date: string, reason: string, version?: number) {
  const r = await safe(async () => { await orders.changeDueDate(await actor(), orderId, new Date(date), reason, version); }, "تم تغيير موعد التسليم");
  revalidatePath("/orders"); revalidatePath(`/orders/${orderId}`); return r;
}
export async function reassignSalesRepAction(orderId: string, newRepId: string, reason: string, version?: number) {
  const r = await safe(async () => { await orders.reassignSalesRep(await actor(), orderId, newRepId, reason, version); }, "تم تغيير موظف المبيعات المسؤول");
  revalidatePath("/orders"); revalidatePath(`/orders/${orderId}`); return r;
}
// ---------- استيراد بنود الطلب (التأكيد يقرأ البنود من القاعدة لا من المتصفح) ----------
export async function confirmImportAction(importId: string, acceptDuplicateFile = false): Promise<ActionResult<{ count: number }>> {
  const { confirmOrderImport } = await import("./services/item-import");
  const r = await safe(async () => {
    const res = await confirmOrderImport(await actor(), importId, { acceptDuplicateFile });
    revalidatePath(`/orders/${res.orderId}`);
    return { count: res.count };
  }, "تم استيراد البنود");
  return r;
}
export async function cancelImportAction(importId: string): Promise<ActionResult> {
  const { cancelOrderImport } = await import("./services/item-import");
  return safe(async () => { await cancelOrderImport(await actor(), importId); });
}
export async function cancelItemQtyAction(orderId: string, itemId: string, qty: number, reason: string) {
  const r = await safe(async () => { await orders.cancelItemQty(await actor(), itemId, qty, reason); }, "تم الإلغاء الجزئي");
  revalidatePath(`/orders/${orderId}`); return r;
}
export async function uploadOrderFilesAction(orderId: string, f: FormData) {
  const r = await safe(async () => {
    const a = await actor(); requirePerm(a, "files.upload");
    await assertOrderAccess(a, orderId);
    const { storeFile } = await import("./services/files");
    const kind = str(f, "kind") ?? "REFERENCE";
    if (!ORDER_FILE_KINDS.includes(kind)) throw rule("نوع الملف غير صالح");
    const files = await filesOf(f, "files");
    if (!files.length) throw rule("اختر ملفًا");
    for (const file of files) await storeFile(db, a, file, kind as never, { orderId });
  }, "تم رفع الملفات");
  revalidatePath(`/orders/${orderId}`); return r;
}

// ---------- التصميم ----------
export async function assignDesignAction(orderId: string, orderItemId: string | undefined, assigneeId: string, dueDate?: string, instructions?: string) {
  const r = await safe(async () => { await design.assignDesign(await actor(), { orderId, orderItemId, assigneeId, dueDate: dueDate ? new Date(dueDate) : undefined, instructions }); }, "تم الإسناد");
  revalidatePath(`/orders/${orderId}`); revalidatePath("/design"); return r;
}
export async function startDesignAction(taskId: string) {
  const r = await safe(async () => design.startDesign(await actor(), taskId)); revalidatePath(`/design/${taskId}`); return r;
}
export async function uploadDesignAction(taskId: string, f: FormData) {
  const r = await safe(async () => { await design.uploadDesignVersion(await actor(), taskId, await filesOf(f, "files"), str(f, "notes")); }, "تم رفع النسخة");
  revalidatePath(`/design/${taskId}`); revalidatePath("/design"); return r;
}
export async function internalReviewAction(taskId: string, approve: boolean, feedback?: string) {
  const r = await safe(async () => design.internalReview(await actor(), taskId, approve, feedback), approve ? "أُرسل للعميل" : "أعيد للمصمم");
  revalidatePath(`/design/${taskId}`); return r;
}
export async function customerDecisionAction(taskId: string, f: FormData) {
  const r = await safe(async () => {
    const proof = (await filesOf(f, "proof"))[0];
    await design.recordCustomerDecision(await actor(), taskId, { approved: f.get("approved") === "yes", approverName: String(f.get("approverName") ?? ""), feedback: str(f, "feedback"), proof });
  }, "تم تسجيل قرار العميل");
  revalidatePath(`/design/${taskId}`); return r;
}

// ---------- الإنتاج ----------
export async function createProductionAction(input: prod.ProductionInput): Promise<ActionResult<{ id: string }>> {
  const r = await safe(async () => ({ id: (await prod.createProductionOrder(await actor(), input)).id }), "تم إنشاء أمر التشغيل");
  revalidatePath(`/orders/${input.orderId}`); revalidatePath("/production"); return r;
}
export async function startProductionAction(id: string) { const r = await safe(async () => prod.startProduction(await actor(), id), "بدأ الإنتاج"); revalidatePath(`/production/${id}`); return r; }
export async function pauseProductionAction(id: string, reason?: string) { const r = await safe(async () => prod.pauseProduction(await actor(), id, reason ?? ""), "تم الإيقاف"); revalidatePath(`/production/${id}`); return r; }
export async function completeStageAction(poId: string, stageId: string) { const r = await safe(async () => prod.completeStage(await actor(), stageId), "اكتملت المرحلة"); revalidatePath(`/production/${poId}`); return r; }
export async function logProgressAction(poId: string, goodQty: number, scrapQty: number, scrapReason: string | undefined, note: string | undefined, idempotencyKey: string) {
  const r = await safe(async () => { await prod.logProgress(await actor(), { productionOrderId: poId, goodQty, scrapQty, scrapReason, note, idempotencyKey }); }, "تم التسجيل");
  revalidatePath(`/production/${poId}`); return r;
}
export async function completeProductionAction(id: string) { const r = await safe(async () => prod.completeProduction(await actor(), id), "أُرسل للجودة"); revalidatePath(`/production/${id}`); revalidatePath("/quality"); return r; }
// ---------- الجودة والتسليم ----------
export async function inspectAction(input: Parameters<typeof quality.inspect>[1]) {
  const r = await safe(async () => { await quality.inspect(await actor(), input); }, "تم حفظ الفحص");
  revalidatePath("/quality"); return r;
}
// التسليم نفسه عبر POST /api/orders/[id]/deliveries (طلب واحد يضم البيانات وصور الإثبات الإلزامية)
/** حذف صورة إثبات تسليم — المدير العام فقط وبسبب إلزامي */
export async function deleteDeliveryProofAction(orderId: string, attachmentId: string, reason?: string) {
  const r = await safe(async () => { await delivery.deleteDeliveryProof(await actor(), attachmentId, reason ?? ""); }, "تم حذف الصورة");
  revalidatePath(`/orders/${orderId}`); return r;
}

// ---------- الإشعارات ----------
/** تعليم إشعار واحد كمقروء — إشعار المستخدم نفسه فقط (F18) */
export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  const r = await safe(async () => { const a = await actor(); await db.notification.updateMany({ where: { id, userId: a.id, readAt: null }, data: { readAt: new Date() } }); });
  revalidatePath("/notifications"); return r;
}
export async function markNotificationsReadAction(): Promise<ActionResult> {
  const r = await safe(async () => { const a = await actor(); await db.notification.updateMany({ where: { userId: a.id, readAt: null }, data: { readAt: new Date() } }); });
  revalidatePath("/notifications"); return r;
}

// ---------- المستخدمون ----------
export async function createUserAction(_: unknown, f: FormData) {
  const r = await safe(async () => {
    const a = await actor(); requirePerm(a, "users.manage");
    const username = String(f.get("username") ?? "").trim().toLowerCase();
    const password = String(f.get("password") ?? "");
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw rule("اسم المستخدم: حروف إنجليزية صغيرة وأرقام فقط (3-30)");
    const pp = passwordProblem(password, username); if (pp) throw rule(pp);
    const role = await db.role.findUnique({ where: { key: String(f.get("role")) } });
    if (!role) throw rule("اختر الدور");
    const u = await db.user.create({ data: { username, fullName: String(f.get("fullName") ?? username), passwordHash: await hashPassword(password), mustChangePassword: true, branchId: a.branchId, roles: { create: { roleId: role.id } } } });
    await audit(db, a.id, "USER_CREATE", "User", u.id, null, { username, role: role.key });
  }, "تم إنشاء الحساب");
  revalidatePath("/settings/users"); return r;
}
export async function toggleUserAction(userId: string) {
  const r = await safe(async () => {
    const a = await actor(); requirePerm(a, "users.manage");
    if (userId === a.id) throw rule("لا يمكنك تعطيل حسابك");
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await db.user.update({ where: { id: userId }, data: { isActive: !u.isActive } });
    if (u.isActive) await db.session.deleteMany({ where: { userId } });
    await audit(db, a.id, u.isActive ? "USER_DISABLE" : "USER_ENABLE", "User", userId);
  });
  revalidatePath("/settings/users"); return r;
}
export async function resetPasswordAction(userId: string, password?: string) {
  return safe(async () => {
    const a = await actor(); requirePerm(a, "users.manage");
    const pp = passwordProblem(password ?? ""); if (pp) throw rule(pp);
    await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password!), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
    await db.session.deleteMany({ where: { userId } });
    await audit(db, a.id, "USER_PASSWORD_RESET", "User", userId);
  }, "تم تعيين كلمة المرور");
}

// ---------- شاشة الإنتاج ----------
export async function saveBoardConfigAction(deviceId: string, cfg: BoardConfig) {
  const r = await safe(async () => {
    const a = await actor(); requirePerm(a, "liveboard.manage");
    const clean: BoardConfig = { ...DEFAULT_BOARD_CONFIG, ...cfg, maxRows: Math.min(30, Math.max(3, cfg.maxRows)), refreshSeconds: Math.min(120, Math.max(3, cfg.refreshSeconds)) };
    await db.liveBoardDevice.update({ where: { id: deviceId }, data: { config: clean as never } });
    await audit(db, a.id, "BOARD_CONFIG", "LiveBoardDevice", deviceId, null, clean);
  }, "تم حفظ إعدادات الشاشة");
  revalidatePath("/settings/live-board"); return r;
}
export async function newBoardDeviceAction(name: string): Promise<ActionResult<{ token: string }>> {
  return safe(async () => {
    const a = await actor(); requirePerm(a, "liveboard.manage");
    const token = randomBytes(24).toString("base64url");
    await db.liveBoardDevice.create({ data: { name: name.trim() || "شاشة", tokenHash: createHash("sha256").update(token).digest("hex"), config: DEFAULT_BOARD_CONFIG as never } });
    await audit(db, a.id, "BOARD_DEVICE_CREATE", "LiveBoardDevice", undefined, null, { name });
    revalidatePath("/settings/live-board");
    return { token };
  });
}
export async function revokeBoardDeviceAction(id: string) {
  const r = await safe(async () => { const a = await actor(); requirePerm(a, "liveboard.manage"); await db.liveBoardDevice.update({ where: { id }, data: { isActive: false } }); });
  revalidatePath("/settings/live-board"); return r;
}

// ---------- الآلات ----------
export async function machineStatusAction(machineId: string, status: "AVAILABLE" | "STOPPED" | "MAINTENANCE", note?: string) {
  const r = await safe(async () => prod.setMachineStatus(await actor(), machineId, status, note ?? ""), "تم تحديث حالة الآلة");
  revalidatePath("/production/machines"); return r;
}
export async function saveMachineAction(_: unknown, f: FormData) {
  const r = await safe(async () => { await prod.upsertMachine(await actor(), {
    id: str(f, "id"), code: String(f.get("code") ?? ""), name: String(f.get("name") ?? ""), type: String(f.get("type") ?? ""),
    capacityPerHour: Number(f.get("capacityPerHour")) || undefined, capacityUnit: str(f, "capacityUnit"), responsibleId: str(f, "responsibleId"), showOnBoard: f.get("showOnBoard") === "on" }); }, "تم حفظ الآلة");
  revalidatePath("/production/machines"); return r;
}

// ---------- نسخ قابلة للربط (bind) من الصفحات الخادمية ----------
export async function logCommunicationFormAction(customerId: string, f: FormData) {
  return logCommunicationAction(customerId, String(f.get("channel") ?? ""), String(f.get("summary") ?? ""));
}
/** الإلغاء الجزئي بصيغة "الكمية: السبب" */
export async function cancelItemQtyPromptAction(orderId: string, itemId: string, text?: string) {
  const [q, ...rest] = (text ?? "").split(/[:：]/);
  const qty = Number(q?.trim());
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false as const, error: "اكتب بالصيغة: الكمية: السبب — مثال 200: طلب العميل" };
  return cancelItemQtyAction(orderId, itemId, qty, rest.join(":").trim());
}

export async function changePasswordAction(_: unknown, f: FormData) {
  const next = String(f.get("next") ?? "");
  if (next !== String(f.get("confirm") ?? "")) return { ok: false as const, error: "التأكيد لا يطابق كلمة المرور الجديدة" };
  const r = await changeOwnPassword(String(f.get("current") ?? ""), next);
  if (!r.ok) return r;
  redirect("/");
}

// ---------- الإعدادات العامة ----------
export async function saveGeneralSettingsAction(input: unknown) {
  const { saveGeneral } = await import("./services/settings");
  const r = await safe(async () => saveGeneral(await actor(), input), "تم حفظ الإعدادات");
  revalidatePath("/settings/general"); return r;
}

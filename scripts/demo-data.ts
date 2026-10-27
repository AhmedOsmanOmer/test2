/**
 * بيانات عرض تجريبية (حوالي 30 طلبًا) لقاعدة التطوير أو الاختبار فقط — كل شيء يمر عبر طبقة الخدمات
 * وبصلاحيات المستخدم التجريبي المناسب، فتُنشأ السجلات الزمنية والتدقيق والإشعارات كما في التطبيق.
 * الطلبات موزعة على sales و sales2 و sales3، بقيم ومبالغ مدفوعة وحالات ومواعيد تسليم متنوعة.
 *
 * التشغيل (بعد SEED_DEMO=true npm run db:seed):  npx tsx scripts/demo-data.ts
 * آمن للتكرار: إن وُجدت طلبات تحمل علامة «(تجريبي)» يتوقف دون تكرار.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { loadActor, type Actor } from "../src/server/actor";
import { randomUUID } from "crypto";
import { createCustomer } from "../src/server/services/customers";
import { createOrder, changeStatus, setOrderMoney, setDepositReceived, addComment } from "../src/server/services/orders";
import { assignDesign, startDesign, uploadDesignVersion, internalReview, recordCustomerDecision } from "../src/server/services/design";
import { createProductionOrder, startProduction, logProgress, completeProduction } from "../src/server/services/production";
import { inspect } from "../src/server/services/quality";
import { createDelivery } from "../src/server/services/delivery";
import { testProofPhoto } from "./test-photo";
import { round2 } from "../src/lib/format";
import type { OrderStatus, Priority } from "../src/generated/prisma/enums";

const MARK = "(تجريبي)";
const ORDER_NOTE = `${MARK} بيانات عرض`;
const D = 86400_000;

if (process.env.NODE_ENV === "production") throw new Error("ممنوع على بيئة الإنتاج");
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("القاعدة ليست محلية — توقف");

const CUSTOMERS: { name: string; type: "COMPANY" | "INDIVIDUAL"; city: string; phone: string }[] = [
  { name: "شركة مطاعم الديرة", type: "COMPANY", city: "الرياض", phone: "0501000001" },
  { name: "مؤسسة نخبة العقارية", type: "COMPANY", city: "جدة", phone: "0501000002" },
  { name: "عيادات ابتسامة لطب الأسنان", type: "COMPANY", city: "الرياض", phone: "0501000003" },
  { name: "شركة واحة التمور", type: "COMPANY", city: "بريدة", phone: "0501000004" },
  { name: "معرض الريم للسيارات", type: "COMPANY", city: "الدمام", phone: "0501000005" },
  { name: "جمعية البر الخيرية", type: "COMPANY", city: "الرياض", phone: "0501000006" },
  { name: "كافيه سحابة", type: "COMPANY", city: "الخبر", phone: "0501000007" },
  { name: "متجر لمسة للهدايا", type: "COMPANY", city: "مكة المكرمة", phone: "0501000008" },
  { name: "مدارس رواد المستقبل الأهلية", type: "COMPANY", city: "الرياض", phone: "0501000009" },
  { name: "شركة الأفق للمقاولات", type: "COMPANY", city: "المدينة المنورة", phone: "0501000010" },
  { name: "أ. خالد الشهري", type: "INDIVIDUAL", city: "الرياض", phone: "0501000011" },
  { name: "أ. نوف القحطاني", type: "INDIVIDUAL", city: "أبها", phone: "0501000012" },
];

type Item = { name: string; quantity: number; unit: string; material?: string; printType?: string; colors?: string; finishing?: string };
const I = {
  card: (q: number): Item => ({ name: "كروت عمل", quantity: q, unit: "كرت", material: "كوشيه مطفي 350 جم", printType: "رقمية", colors: "4 ألوان وجهين", finishing: "سلوفان مطفي" }),
  rollup: (q: number): Item => ({ name: "رول أب ستاند", quantity: q, unit: "قطعة", material: "بنر PVC 440 جم", printType: "سولفنت", finishing: "تركيب على الستاند" }),
  sticker: (q: number): Item => ({ name: "استيكرات دائرية للمنتجات", quantity: q, unit: "قطعة", material: "فينيل لاصق", printType: "رقمية + قص كونتور" }),
  flex: (q: number): Item => ({ name: "بنر فلكس خارجي 6×3 م", quantity: q, unit: "قطعة", material: "فلكس 440 جم", printType: "سولفنت خارجي", finishing: "حلقات معدنية" }),
  box: (q: number): Item => ({ name: "علب تغليف مطبوعة", quantity: q, unit: "علبة", material: "دوبلكس 350 جم", printType: "أوفست", finishing: "سلوفان لامع" }),
  brochure: (q: number): Item => ({ name: "بروشور A4 مطوي", quantity: q, unit: "نسخة", material: "كوشيه 170 جم", printType: "أوفست", finishing: "طي ثلاثي" }),
  bag: (q: number): Item => ({ name: "أكياس كرافت بيد حبل", quantity: q, unit: "كيس", material: "كرافت 120 جم", printType: "أوفست", finishing: "يد حبل" }),
  cup: (q: number): Item => ({ name: "أكواب سيراميك مطبوعة", quantity: q, unit: "كوب", printType: "DTF UV" }),
};

interface Spec { t: OrderStatus; c: number; rep: "sales" | "sales2" | "sales3"; pr: Priority; due: number; total: number; items: Item[]; noDesign?: boolean; paidPct?: number; reason?: string; comment?: string }
const SPECS: Spec[] = [
  { t: "NEW", c: 0, rep: "sales", pr: "NORMAL", due: 14, total: 0, items: [I.brochure(3000), I.card(1000)] },
  { t: "NEW", c: 10, rep: "sales2", pr: "HIGH", due: 2, total: 350, items: [I.card(500)] },
  { t: "REVIEW", c: 4, rep: "sales3", pr: "NORMAL", due: 18, total: 0, items: [I.flex(2), I.rollup(4)] },
  { t: "REVIEW", c: 11, rep: "sales", pr: "NORMAL", due: 12, total: 740, items: [I.sticker(2000)] },
  { t: "AWAITING_CUSTOMER_APPROVAL", c: 2, rep: "sales2", pr: "HIGH", due: 10, total: 4370, items: [I.card(2000), I.brochure(2000)], comment: "العميل طلب عينة مطبوعة قبل الاعتماد النهائي." },
  { t: "AWAITING_CUSTOMER_APPROVAL", c: 7, rep: "sales3", pr: "NORMAL", due: 20, total: 3105, items: [I.cup(150)] },
  { t: "AWAITING_DEPOSIT", c: 5, rep: "sales", pr: "NORMAL", due: 16, total: 2990, items: [I.rollup(6), I.flex(1)] },
  { t: "AWAITING_DEPOSIT", c: 3, rep: "sales2", pr: "HIGH", due: 9, total: 8280, items: [I.box(3000)], paidPct: 20 },
  { t: "AWAITING_DESIGN", c: 6, rep: "sales3", pr: "NORMAL", due: 13, total: 1610, items: [I.sticker(3000), I.card(1000)] },
  { t: "IN_DESIGN", c: 10, rep: "sales", pr: "URGENT", due: 2, total: 600, items: [I.rollup(2)] },
  { t: "IN_DESIGN", c: 0, rep: "sales2", pr: "NORMAL", due: -2, total: 4310, items: [I.brochure(5000)] },
  { t: "DESIGN_REVIEW", c: 8, rep: "sales3", pr: "HIGH", due: 6, total: 6440, items: [I.box(2000), I.sticker(1000)] },
  { t: "AWAITING_DESIGN_APPROVAL", c: 1, rep: "sales", pr: "HIGH", due: -1, total: 7360, items: [I.bag(2000)] },
  { t: "AWAITING_DESIGN_APPROVAL", c: 11, rep: "sales2", pr: "NORMAL", due: 8, total: 520, items: [I.card(1000)] },
  { t: "MATERIALS_PREP", c: 4, rep: "sales3", pr: "NORMAL", due: 15, total: 2100, items: [I.flex(3)], noDesign: true },
  { t: "PRODUCTION_SCHEDULED", c: 3, rep: "sales", pr: "NORMAL", due: 14, total: 7475, items: [I.box(2500)] },
  { t: "PRODUCTION_SCHEDULED", c: 9, rep: "sales2", pr: "URGENT", due: 3, total: 2530, items: [I.rollup(4), I.flex(2)], noDesign: true },
  { t: "IN_PRODUCTION", c: 5, rep: "sales3", pr: "URGENT", due: -1, total: 2715, items: [I.flex(4)], noDesign: true, comment: "البنر الرابع يحتاج لحامًا إضافيًا للأطراف." },
  { t: "IN_PRODUCTION", c: 0, rep: "sales", pr: "HIGH", due: 2, total: 3970, items: [I.card(2000), I.brochure(3000)] },
  { t: "FINISHING_PACKAGING", c: 7, rep: "sales2", pr: "NORMAL", due: 5, total: 7360, items: [I.bag(2000)], paidPct: 75 },
  { t: "QUALITY_CHECK", c: 6, rep: "sales3", pr: "NORMAL", due: 6, total: 1610, items: [I.sticker(5000)] },
  { t: "QUALITY_CHECK", c: 2, rep: "sales", pr: "HIGH", due: 3, total: 1150, items: [I.rollup(3), I.card(500)], noDesign: true },
  { t: "READY_FOR_DELIVERY", c: 1, rep: "sales2", pr: "NORMAL", due: 7, total: 1955, items: [I.sticker(1000), I.flex(1)], paidPct: 75 },
  { t: "OUT_FOR_DELIVERY", c: 10, rep: "sales3", pr: "NORMAL", due: 1, total: 4255, items: [I.brochure(4000), I.card(1000)] },
  { t: "DELIVERED", c: 2, rep: "sales", pr: "NORMAL", due: 3, total: 1380, items: [I.card(3000)], paidPct: 75 },
  { t: "DELIVERED", c: 11, rep: "sales2", pr: "NORMAL", due: 2, total: 2530, items: [I.cup(100), I.sticker(500)], paidPct: 100 },
  { t: "CLOSED", c: 3, rep: "sales3", pr: "NORMAL", due: 2, total: 16330, items: [I.box(3000), I.bag(2000)] },
  { t: "CLOSED", c: 9, rep: "sales", pr: "HIGH", due: 2, total: 1270, items: [I.flex(1), I.rollup(2)], noDesign: true },
  { t: "ON_HOLD", c: 6, rep: "sales2", pr: "NORMAL", due: 10, total: 7820, items: [I.box(2000)], reason: "بانتظار شعار العميل بصيغة فيكتور (AI)" },
  { t: "NEEDS_REVISION", c: 8, rep: "sales3", pr: "NORMAL", due: 12, total: 1955, items: [I.brochure(2000)], reason: "العميل طلب تغيير المقاس إلى A5" },
  { t: "REWORK", c: 5, rep: "sales", pr: "HIGH", due: 4, total: 1035, items: [I.sticker(3000)], noDesign: true },
  { t: "CANCELLED", c: 7, rep: "sales2", pr: "NORMAL", due: 9, total: 3105, items: [I.cup(150)], reason: "العميل ألغى الفعالية" },
];
/** الحالة على المسار الرئيسي التي يصلها الطلب قبل الاستثناء */
const BASE: Partial<Record<OrderStatus, OrderStatus>> = { ON_HOLD: "IN_DESIGN", NEEDS_REVISION: "REVIEW", CANCELLED: "AWAITING_DEPOSIT", REWORK: "QUALITY_CHECK" };
const FLOW: OrderStatus[] = ["NEW", "REVIEW", "AWAITING_CUSTOMER_APPROVAL", "AWAITING_DEPOSIT", "AWAITING_DESIGN", "IN_DESIGN", "DESIGN_REVIEW",
  "AWAITING_DESIGN_APPROVAL", "MATERIALS_PREP", "PRODUCTION_SCHEDULED", "IN_PRODUCTION", "FINISHING_PACKAGING", "QUALITY_CHECK",
  "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED", "CLOSED"];
const reached = (target: OrderStatus, s: OrderStatus) => FLOW.indexOf(target) >= FLOW.indexOf(s);
const allChecks = { dimensions: true, colors: true, printQuality: true, materials: true, finishing: true, packaging: true, quantity: true };
const pdf = (t: string) => Buffer.from(`%PDF-1.4\n% ${t}\n%%EOF\n`, "latin1");

async function main() {
  const existing = await db.order.count({ where: { notes: { startsWith: ORDER_NOTE } } });
  if (existing) { console.log(`✓ البيانات التجريبية موجودة مسبقًا (${existing} طلب) — لا تكرار`); return; }
  const as = async (u: string) => {
    const user = await db.user.findUnique({ where: { username: u } });
    if (!user) throw new Error(`المستخدم التجريبي ${u} غير موجود — شغّل: SEED_DEMO=true npm run db:seed`);
    return (await loadActor(user.id))!;
  };
  const A: Record<string, Actor> = {};
  for (const u of ["sales", "sales2", "sales3", "salessup", "ops", "designer", "designer2", "supervisor", "worker", "worker2", "qc", "delivery"]) A[u] = await as(u);
  const machines = await db.machine.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
  if (!machines.length) throw new Error("لا توجد آلات — شغّل SEED_DEMO=true npm run db:seed");

  // العملاء (تُعاد استخدامها إن وُجدت)
  const customers: string[] = [];
  for (const c of CUSTOMERS) {
    const name = `${c.name} ${MARK}`;
    const found = await db.customer.findFirst({ where: { name } });
    customers.push(found?.id ?? (await createCustomer(A.sales, { name, type: c.type, city: c.city, phone: c.phone })).id);
  }

  let slot = 0;
  const nextSlot = () => { const s = new Date(Date.now() + (slot * 3 - 2) * 3600_000); slot++; return [s, new Date(s.getTime() + 2 * 3600_000)] as const; };

  for (const [k, sp] of SPECS.entries()) {
    const target = BASE[sp.t] ?? sp.t;
    const rep = A[sp.rep];
    const o = await createOrder(rep, {
      customerId: customers[sp.c], dueDate: new Date(Date.now() + Math.max(sp.due, 1) * D), priority: sp.pr, requiresDesign: !sp.noDesign,
      total: sp.total || undefined, notes: `${ORDER_NOTE} #${String(k + 1).padStart(2, "0")}`, items: sp.items,
    });
    const id = o.id;
    const go = (to: OrderStatus, who: Actor = rep, reason?: string) => changeStatus(who, id, to, reason);
    if (reached(target, "REVIEW")) await go("REVIEW");
    if (reached(target, "AWAITING_CUSTOMER_APPROVAL")) await go("AWAITING_CUSTOMER_APPROVAL");
    if (reached(target, "AWAITING_DEPOSIT")) await go("AWAITING_DEPOSIT");
    const pct = sp.paidPct ?? (reached(target, "AWAITING_DESIGN") ? 50 : 0);
    if (pct) await setOrderMoney(rep, id, { paidAmount: round2((sp.total * Math.min(pct, 100)) / 100) });
    if (reached(target, "AWAITING_DESIGN")) await setDepositReceived(A.salessup, id, true);

    if (!sp.noDesign && reached(target, "IN_DESIGN")) {
      const designer = k % 2 ? A.designer2 : A.designer;
      const t = await assignDesign(A.ops, { orderId: id, assigneeId: designer.id, dueDate: new Date(Date.now() + 2 * D), instructions: "الالتزام بهوية العميل" });
      if (reached(target, "DESIGN_REVIEW")) {
        await startDesign(designer, t.id);
        await uploadDesignVersion(designer, t.id, [{ name: `design-${k + 1}-v1.pdf`, bytes: pdf(`design ${k + 1}`) }], "النسخة الأولى");
      }
      if (reached(target, "AWAITING_DESIGN_APPROVAL")) await internalReview(A.ops, t.id, true);
      if (reached(target, "MATERIALS_PREP")) await recordCustomerDecision(A.ops, t.id, { approved: true, approverName: "ممثل العميل" });
    }

    const pos: string[] = [];
    if (reached(target, "PRODUCTION_SCHEDULED")) {
      const items = await db.orderItem.findMany({ where: { orderId: id }, orderBy: { sortOrder: "asc" } });
      for (const [j, it] of items.entries()) {
        const [s, e] = nextSlot();
        const po = await createProductionOrder(A.supervisor, {
          orderId: id, orderItemId: it.id, quantity: it.quantity, machineId: machines[(k + j) % machines.length].id,
          assigneeId: (k + j) % 2 ? A.worker2.id : A.worker.id, plannedStart: s, plannedEnd: e, stages: ["تجهيز الملفات", "الطباعة", "القص", "التغليف"],
        });
        pos.push(po.id);
      }
    }
    if (reached(target, "IN_PRODUCTION")) for (const p of pos) await startProduction(A.supervisor, p);
    if (target === "IN_PRODUCTION") {
      const po = await db.productionOrder.findUniqueOrThrow({ where: { id: pos[0] } });
      await logProgress(A.supervisor, { productionOrderId: po.id, goodQty: Math.floor(po.quantity / 2), scrapQty: 0, idempotencyKey: randomUUID() });
    }
    if (target === "FINISHING_PACKAGING") await go("FINISHING_PACKAGING", A.supervisor);
    if (reached(target, "QUALITY_CHECK") && target !== "FINISHING_PACKAGING") {
      for (const p of pos) {
        const po = await db.productionOrder.findUniqueOrThrow({ where: { id: p } });
        await logProgress(A.supervisor, { productionOrderId: p, goodQty: po.quantity, scrapQty: 0, idempotencyKey: randomUUID() });
        await completeProduction(A.supervisor, p);
      }
    }
    if (sp.t === "REWORK") {
      const po = await db.productionOrder.findUniqueOrThrow({ where: { id: pos[0] } });
      await inspect(A.qc, { productionOrderId: po.id, acceptedQty: po.completedQty - 300, rejectedQty: 300, checks: { ...allChecks, colors: false }, result: "REWORK", rejectReason: "اختلاف درجة اللون" });
    } else if (reached(target, "READY_FOR_DELIVERY")) {
      for (const p of pos) {
        const po = await db.productionOrder.findUniqueOrThrow({ where: { id: p } });
        await inspect(A.qc, { productionOrderId: p, acceptedQty: po.completedQty, rejectedQty: 0, checks: allChecks, result: "ACCEPTED" });
      }
    }
    if (reached(target, "OUT_FOR_DELIVERY")) {
      const items = await db.orderItem.findMany({ where: { orderId: id }, orderBy: { sortOrder: "asc" } });
      const half = target === "OUT_FOR_DELIVERY";
      await createDelivery(A.delivery, {
        orderId: id, method: half ? "COURIER" : "PICKUP", recipientName: "مندوب العميل",
        items: items.map((i) => ({ orderItemId: i.id, quantity: half ? Math.ceil(i.quantity / 2) : i.quantity })), idempotencyKey: randomUUID(),
      }, [testProofPhoto()]);
    }
    if (target === "CLOSED") {
      await setOrderMoney(rep, id, { paidAmount: sp.total });
      await changeStatus(A.salessup, id, "CLOSED");
    }
    if (sp.t === "ON_HOLD" || sp.t === "NEEDS_REVISION") await go(sp.t, A.ops, sp.reason);
    if (sp.t === "CANCELLED") await go("CANCELLED", A.ops, sp.reason);
    if (sp.comment) await addComment(rep, id, sp.comment);
    // مواعيد تسليم ماضية للطلبات المتأخرة (الواجهة والخادم يمنعان إدخالها مباشرة)
    if (sp.due < 1) await db.order.update({ where: { id }, data: { dueDate: new Date(Date.now() + sp.due * D) } });
    const now = await db.order.findUniqueOrThrow({ where: { id }, select: { number: true, status: true } });
    if (now.status !== sp.t) throw new Error(`${now.number}: الحالة ${now.status} بدل ${sp.t}`);
    console.log(`  ✓ ${now.number} — ${sp.rep} — ${sp.t}`);
  }
  console.log(`\n✓ تم إنشاء ${SPECS.length} طلبًا تجريبيًا لـ ${CUSTOMERS.length} عميلًا`);
}
main().then(() => db.$disconnect()).catch(async (e) => { console.error("✗", e.message); await db.$disconnect(); process.exit(1); });

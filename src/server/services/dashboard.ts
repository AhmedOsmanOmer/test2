import { db } from "@/lib/db";
import { FINISHED } from "@/lib/order-flow";
import { round2 } from "@/lib/format";
import { can, requirePerm, type Actor } from "../actor";
import { orderScope } from "./access";
import type { OrderStatus } from "@/generated/prisma/enums";

export type Period = "today" | "week" | "month" | "year" | "custom";
export function periodRange(p: Period, from?: string, to?: string) {
  const now = new Date(); const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (p === "week") start.setDate(start.getDate() - 6);
  if (p === "month") start.setDate(1);
  if (p === "year") start.setMonth(0, 1);
  if (p === "custom" && from) return { from: new Date(from), to: to ? new Date(new Date(to).getTime() + 86400_000) : now };
  return { from: start, to: new Date(now.getTime() + 1000) };
}

const DESIGN: OrderStatus[] = ["AWAITING_DESIGN", "IN_DESIGN", "DESIGN_REVIEW"];
const PROD: OrderStatus[] = ["MATERIALS_PREP", "PRODUCTION_SCHEDULED", "IN_PRODUCTION", "FINISHING_PACKAGING", "QUALITY_CHECK", "REWORK"];

export async function getDashboard(actor: Actor, range: { from: Date; to: Date }) {
  requirePerm(actor, "dashboard.view");
  const financial = can(actor, "dashboard.financial");
  const scope = orderScope(actor);
  const inPeriod = { createdAt: { gte: range.from, lt: range.to } };
  const now = new Date();
  const [byStatus, lateCount, delivered, moneyAgg, recentLate, prodCounts, users] = await Promise.all([
    db.order.groupBy({ by: ["status"], where: scope, _count: true }),
    db.order.count({ where: { ...scope, dueDate: { lt: now }, status: { notIn: FINISHED } } }),
    db.order.findMany({ where: { ...scope, completedAt: { gte: range.from, lt: range.to } }, select: { createdAt: true, completedAt: true, dueDate: true } }),
    // المال للمدير العام فقط: قيمة الطلبات النشطة المنشأة في الفترة، والمتبقي على كل الطلبات غير الملغاة
    financial ? Promise.all([
      db.order.aggregate({ where: { ...inPeriod, status: { not: "CANCELLED" } }, _sum: { total: true } }),
      db.order.aggregate({ where: { status: { not: "CANCELLED" } }, _sum: { total: true, paidAmount: true } }),
    ]) : Promise.resolve(null),
    db.order.findMany({
      where: { ...scope, dueDate: { lt: now }, status: { notIn: FINISHED } }, orderBy: { dueDate: "asc" }, take: 8,
      select: { id: true, number: true, status: true, dueDate: true, delayReason: true, customer: { select: { name: true } }, salesRep: { select: { fullName: true } } },
    }),
    db.productionOrder.groupBy({ by: ["machineId"], where: { status: { in: ["IN_PROGRESS", "SCHEDULED"] } }, _count: true }),
    db.user.findMany({
      where: { isActive: true, roles: { some: { role: { key: { in: ["DESIGNER", "PRODUCTION_WORKER", "SALES", "SALES_SUPERVISOR"] } } } } },
      select: {
        fullName: true,
        _count: { select: { designTasks: { where: { status: "APPROVED", updatedAt: { gte: range.from } } }, productionOrders: { where: { actualEnd: { gte: range.from } } }, salesOrders: { where: inPeriod } } },
      },
    }),
  ]);
  const count = (ss: OrderStatus[]) => byStatus.filter((b) => ss.includes(b.status)).reduce((s, b) => s + b._count, 0);
  const all = byStatus.reduce((s, b) => s + b._count, 0);
  const machines = await db.machine.findMany({ where: { isActive: true }, select: { id: true, name: true, status: true } });

  const kpis = {
    total: all,
    newOrders: count(["NEW", "REVIEW", "AWAITING_CUSTOMER_APPROVAL"]),
    awaitingDeposit: count(["AWAITING_DEPOSIT"]),
    inDesign: count(DESIGN),
    awaitingApproval: count(["AWAITING_DESIGN_APPROVAL"]),
    inProduction: count(PROD),
    late: lateCount,
    ready: count(["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"]),
    completed: count(["DELIVERED", "CLOSED"]),
    cancelled: count(["CANCELLED"]),
    avgLeadDays: delivered.length ? round2(delivered.reduce((s, o) => s + (o.completedAt!.getTime() - o.createdAt.getTime()) / 86400_000, 0) / delivered.length) : 0,
    onTimePct: delivered.length ? Math.round((delivered.filter((o) => o.completedAt! <= o.dueDate).length / delivered.length) * 100) : null,
  };
  const money = moneyAgg ? {
    ordersValue: round2(Number(moneyAgg[0]._sum.total ?? 0)),
    outstanding: round2(Number(moneyAgg[1]._sum.total ?? 0) - Number(moneyAgg[1]._sum.paidAmount ?? 0)),
  } : null;

  // عدد الطلبات شهريًا للسنة الحالية
  const monthly = Array.from({ length: 12 }, (_, m) => ({ month: m + 1, orders: 0 }));
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearOrders = await db.order.findMany({ where: { ...scope, createdAt: { gte: yearStart } }, select: { createdAt: true } });
  for (const o of yearOrders) monthly[o.createdAt.getMonth()].orders++;

  return {
    kpis, money, monthly,
    byStatus: byStatus.map((b) => ({ status: b.status, count: b._count })),
    recentLate,
    capacity: machines.map((m) => ({ name: m.name, status: m.status, jobs: prodCounts.find((p) => p.machineId === m.id)?._count ?? 0 })),
    people: users.map((u) => ({ name: u.fullName, designs: u._count.designTasks, production: u._count.productionOrders, sales: u._count.salesOrders })),
  };
}

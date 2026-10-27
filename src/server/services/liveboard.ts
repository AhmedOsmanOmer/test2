/**
 * بيانات شاشة الإنتاج المباشر.
 * مبدأ الأمان: قائمة بيضاء صريحة للحقول (select) — لا يُقرأ أي حقل مالي أو بيانات تواصل
 * من قاعدة البيانات أصلًا، ثم يُبنى DTO جديد بالحقول المسموحة فقط.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";

export interface BoardConfig {
  sections: { kpis: boolean; active: boolean; late: boolean; next: boolean; machines: boolean };
  machineIds: string[] | null; // null = كل الآلات الظاهرة
  maxRows: number;
  refreshSeconds: number;
  autoScroll: boolean;
  colors: { onTrack: string; atRisk: string; late: string; scheduled: string; stopped: string };
}
export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  sections: { kpis: true, active: true, late: true, next: true, machines: true },
  machineIds: null, maxRows: 10, refreshSeconds: 10, autoScroll: true,
  colors: { onTrack: "#22C55E", atRisk: "#F2B71F", late: "#EF4444", scheduled: "#38BDF8", stopped: "#64748B" },
};

export type Health = "onTrack" | "atRisk" | "late" | "scheduled" | "stopped";
export interface BoardRow {
  ref: string; orderNo: string; prNo: string; product: string; quantity: number; stage: string; assignee: string; machine: string;
  progress: number; eta: string | null; start: string | null; health: Health; priority: string; delayMinutes?: number;
}
export interface BoardData {
  generatedAt: string;
  kpis: { inProduction: number; completedToday: number; late: number; urgent: number; upcoming: number; dailyProgress: number };
  active: BoardRow[]; late: BoardRow[]; next: BoardRow[];
  machines: { name: string; type: string; status: string }[];
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export async function resolveDevice(token: string | null) {
  if (!token || token.length < 20) return null;
  const d = await db.liveBoardDevice.findUnique({ where: { tokenHash: hash(token) } });
  if (!d || !d.isActive) return null;
  await db.liveBoardDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return { ...d, config: { ...DEFAULT_BOARD_CONFIG, ...(d.config as object) } as BoardConfig };
}

function health(p: { status: string; plannedEnd: Date | null; progressPct: number; plannedStart: Date | null }, orderDue: Date, now: Date): Health {
  if (p.status === "PAUSED") return "stopped";
  if (p.status === "SCHEDULED" || p.status === "PLANNED") return "scheduled";
  const end = p.plannedEnd ?? orderDue;
  if (end < now) return "late";
  if (p.plannedStart && p.plannedEnd) {
    const elapsed = (now.getTime() - p.plannedStart.getTime()) / (p.plannedEnd.getTime() - p.plannedStart.getTime());
    if (elapsed * 100 - p.progressPct > 20) return "atRisk";
  } else if (end.getTime() - now.getTime() < 4 * 3600_000 && p.progressPct < 80) return "atRisk";
  return "onTrack";
}

export async function getBoardData(cfg: BoardConfig = DEFAULT_BOARD_CONFIG, now = new Date()): Promise<BoardData> {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const select = {
    number: true, quantity: true, status: true, priority: true, progressPct: true, plannedStart: true, plannedEnd: true, actualEnd: true,
    orderItem: { select: { name: true } },
    order: { select: { number: true, dueDate: true } },
    machine: { select: { name: true } },
    assignee: { select: { fullName: true } },
    stages: { select: { name: true, status: true, sequence: true }, orderBy: { sequence: "asc" as const } },
  } as const;
  const machineFilter = cfg.machineIds?.length ? { machineId: { in: cfg.machineIds } } : {};
  const [running, upcoming, doneToday, machines] = await Promise.all([
    db.productionOrder.findMany({ where: { status: { in: ["IN_PROGRESS", "PAUSED"] }, ...machineFilter }, select, orderBy: [{ priority: "desc" }, { plannedEnd: "asc" }] }),
    db.productionOrder.findMany({ where: { status: { in: ["SCHEDULED", "PLANNED"] }, ...machineFilter }, select, orderBy: [{ priority: "desc" }, { plannedStart: "asc" }], take: cfg.maxRows }),
    db.productionOrder.count({ where: { actualEnd: { gte: startOfDay }, status: { in: ["QC_PENDING", "QC_PASSED", "COMPLETED", "QC_FAILED"] } } }),
    db.machine.findMany({ where: { isActive: true, showOnBoard: true, ...(cfg.machineIds?.length ? { id: { in: cfg.machineIds } } : {}) }, select: { name: true, type: true, status: true }, orderBy: { name: "asc" } }),
  ]);
  const toRow = (p: (typeof running)[number]): BoardRow => {
    const h = health(p, p.order.dueDate, now);
    const end = p.plannedEnd ?? p.order.dueDate;
    const current = p.stages.find((s) => s.status === "IN_PROGRESS") ?? p.stages.find((s) => s.status === "PENDING");
    return {
      ref: `${p.order.number} · ${p.number}`, orderNo: p.order.number, prNo: p.number, product: p.orderItem.name, quantity: p.quantity, stage: current?.name ?? "—",
      assignee: p.assignee?.fullName ?? "غير مسند", machine: p.machine?.name ?? "—", progress: p.progressPct,
      eta: p.plannedEnd?.toISOString() ?? null, start: p.plannedStart?.toISOString() ?? null, health: h, priority: p.priority,
      delayMinutes: h === "late" ? Math.round((now.getTime() - end.getTime()) / 60000) : undefined,
    };
  };
  const activeRows = running.map(toRow);
  const lateRows = activeRows.filter((r) => r.health === "late");
  const target = running.length + doneToday;
  return {
    generatedAt: now.toISOString(),
    kpis: {
      inProduction: running.length, completedToday: doneToday, late: lateRows.length,
      urgent: [...running, ...upcoming].filter((p) => p.priority === "URGENT").length, upcoming: upcoming.length,
      dailyProgress: target ? Math.round((doneToday / target) * 100) : 0,
    },
    active: activeRows.slice(0, cfg.maxRows), late: lateRows.slice(0, cfg.maxRows), next: upcoming.map(toRow),
    machines: machines.map((m) => ({ name: m.name, type: m.type, status: m.status })),
  };
}

/** بصمة البيانات لمعرفة إن تغيّر شيء (للتحديث الفوري عبر SSE) */
export const fingerprint = (d: BoardData) => hash(JSON.stringify({ ...d, generatedAt: "" }));

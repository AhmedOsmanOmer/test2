import { currentActor } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { resolveDevice, DEFAULT_BOARD_CONFIG, type BoardConfig } from "@/server/services/liveboard";

/** الوصول للشاشة: رمز جهاز (قراءة فقط لهذه البيانات) أو مستخدم مسجل لديه صلاحية عرض الإنتاج */
export async function boardAccess(req: Request): Promise<{ config: BoardConfig; name: string } | null> {
  const url = new URL(req.url);
  const token = url.searchParams.get("device") ?? req.headers.get("x-board-token");
  if (token) {
    const d = await resolveDevice(token);
    return d ? { config: d.config, name: d.name } : null;
  }
  const a = await currentActor();
  if (!a || !can(a, "production.view")) return null;
  const first = await db.liveBoardDevice.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  return { config: { ...DEFAULT_BOARD_CONFIG, ...((first?.config as object) ?? {}) } as BoardConfig, name: "معاينة" };
}

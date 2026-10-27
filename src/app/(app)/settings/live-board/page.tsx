import { requireActor, pagePerm } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DEFAULT_BOARD_CONFIG, type BoardConfig } from "@/server/services/liveboard";
import { BoardSettings } from "./form";
import { dateTime } from "@/lib/format";

export default async function LiveBoardSettings() {
  const a = await requireActor(); pagePerm(a, "liveboard.manage");
  const [devices, machines] = await Promise.all([db.liveBoardDevice.findMany({ orderBy: { createdAt: "asc" } }), db.machine.findMany({ where: { isActive: true }, select: { id: true, name: true } })]);
  return (
    <>
      <PageHeader title="إعدادات شاشة الإنتاج المباشر" subtitle="كل شاشة تلفاز لها رابط خاص يمنحها عرض البيانات التشغيلية فقط" />
      <BoardSettings machines={machines} devices={devices.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive, lastSeen: d.lastSeenAt ? dateTime(d.lastSeenAt) : null, config: { ...DEFAULT_BOARD_CONFIG, ...(d.config as object) } as BoardConfig }))} />
    </>
  );
}

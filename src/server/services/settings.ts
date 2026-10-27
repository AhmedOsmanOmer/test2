import { z } from "zod";
import { db } from "@/lib/db";
import { requirePerm, type Actor } from "../actor";
import { audit } from "./audit";

export const generalSchema = z.object({
  "company.nameAr": z.string().trim().min(2, "اسم الشركة بالعربية مطلوب").max(200),
  "company.nameEn": z.string().trim().max(200),
  "company.vatNumber": z.string().trim().regex(/^(3\d{13}3)?$/, "الرقم الضريبي: 15 رقمًا يبدأ وينتهي بـ 3"),
  "company.crNumber": z.string().trim().max(20),
  "company.address": z.string().trim().max(300),
  "company.phone": z.string().trim().max(30),
  "work.hours": z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }),
  "work.weekend": z.array(z.number().int().min(0).max(6)).max(3),
});
export type GeneralSettings = z.infer<typeof generalSchema>;

export async function getGeneral(): Promise<GeneralSettings> {
  const rows = await db.systemSetting.findMany();
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    "company.nameAr": String(m["company.nameAr"] ?? "شركة بوابة الطباعة للدعاية والإعلان"), "company.nameEn": String(m["company.nameEn"] ?? "Printing gate"),
    "company.vatNumber": String(m["company.vatNumber"] ?? ""), "company.crNumber": String(m["company.crNumber"] ?? ""),
    "company.address": String(m["company.address"] ?? ""), "company.phone": String(m["company.phone"] ?? ""),
    "work.hours": (m["work.hours"] as GeneralSettings["work.hours"]) ?? { start: "08:00", end: "17:00" },
    "work.weekend": (m["work.weekend"] as number[]) ?? [5, 6],
  };
}

/** بيانات الشركة (تظهر في سندات التسليم) وساعات العمل */
export async function saveGeneral(actor: Actor, input: unknown) {
  requirePerm(actor, "settings.manage");
  const d = generalSchema.parse(input);
  const before = await getGeneral();
  await db.$transaction(Object.entries(d).map(([key, value]) => db.systemSetting.upsert({ where: { key }, update: { value: value as never, updatedBy: actor.id }, create: { key, value: value as never, updatedBy: actor.id } })));
  await audit(db, actor.id, "SETTINGS_UPDATE", "SystemSetting", undefined, before, d);
}

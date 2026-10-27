/**
 * بيانات أولية + بيانات تجريبية واضحة للاختبار فقط.
 * كل المستخدمين التجريبيين يبدأ اسمهم بـ "(تجريبي)" ويجب تعطيلهم قبل التشغيل الفعلي.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { db } from "../src/lib/db";
import { PERMISSIONS, ROLES } from "../src/lib/permissions";
import { DEFAULT_BOARD_CONFIG } from "../src/server/services/liveboard";

async function main() {
  const pw = process.env.SEED_ADMIN_PASSWORD;
  if (!pw || pw.length < 10) throw new Error("حدد SEED_ADMIN_PASSWORD (10 أحرف على الأقل) في .env");
  const hash = await bcrypt.hash(pw, 12);

  const branch = await db.branch.upsert({ where: { code: "RUH" }, update: {}, create: { code: "RUH", name: "الفرع الرئيسي - الرياض" } });

  for (const [key, [name, module]] of Object.entries(PERMISSIONS))
    await db.permission.upsert({ where: { key }, update: { name, module }, create: { key, name, module } });
  // إزالة الأدوار والصلاحيات التي لم تعد في الكتالوج (المخزون، المحاسب، الصلاحيات المالية القديمة)
  await db.role.deleteMany({ where: { key: { notIn: Object.keys(ROLES) } } });
  await db.permission.deleteMany({ where: { key: { notIn: Object.keys(PERMISSIONS) } } });
  const perms = await db.permission.findMany();
  for (const [key, r] of Object.entries(ROLES)) {
    const role = await db.role.upsert({ where: { key }, update: { name: r.name }, create: { key, name: r.name, isSystem: true } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: r.permissions.map((p) => ({ roleId: role.id, permissionId: perms.find((x) => x.key === p)!.id })) });
  }

  const users: [string, string, string, "MANAGEMENT" | "SALES" | "DESIGN" | "PRODUCTION" | "QUALITY" | "DELIVERY"][] = [
    ["admin", "المدير العام", "SUPER_ADMIN", "MANAGEMENT"],
    ["ops", "(تجريبي) مدير العمليات", "OPERATIONS_MANAGER", "MANAGEMENT"],
    ["salessup", "مشرف المبيعات (تجريبي)", "SALES_SUPERVISOR", "SALES"],
    ["sales", "(تجريبي) سارة - مبيعات", "SALES", "SALES"],
    ["sales2", "(تجريبي) عبدالله - مبيعات", "SALES", "SALES"],
    ["sales3", "(تجريبي) لمى - مبيعات", "SALES", "SALES"],
    ["designer", "(تجريبي) خالد - مصمم", "DESIGNER", "DESIGN"],
    ["designer2", "(تجريبي) نورة - مصممة", "DESIGNER", "DESIGN"],
    ["supervisor", "(تجريبي) فهد - مشرف إنتاج", "PRODUCTION_SUPERVISOR", "PRODUCTION"],
    ["worker", "(تجريبي) ماجد - فني طباعة", "PRODUCTION_WORKER", "PRODUCTION"],
    ["worker2", "(تجريبي) سامي - فني قص وتشكيل", "PRODUCTION_WORKER", "PRODUCTION"],
    ["qc", "(تجريبي) ريم - الجودة", "QUALITY", "QUALITY"],
    ["delivery", "(تجريبي) ياسر - التسليم", "DELIVERY", "DELIVERY"],
  ];
  // في الإنتاج: يُنشأ حساب المدير فقط. المستخدمون التجريبيون فقط عند SEED_DEMO=true
  const demo = process.env.SEED_DEMO === "true";
  for (const [username, fullName, roleKey, department] of demo ? users : users.slice(0, 1)) {
    const u = await db.user.upsert({
      where: { username }, update: {},
      create: { username, fullName, passwordHash: hash, branchId: branch.id, department, mustChangePassword: true },
    });
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
    await db.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId: role.id } }, update: {}, create: { userId: u.id, roleId: role.id } });
  }

  const settings: Record<string, unknown> = {
    "company.nameAr": "شركة بوابة الطباعة للدعاية والإعلان", "company.nameEn": "Printing gate",
    "company.vatNumber": "", "company.crNumber": "", "company.address": "الرياض، المملكة العربية السعودية", "company.phone": "",
    "currency": "SAR",
    "work.hours": { start: "08:00", end: "17:00" }, "work.weekend": [5, 6],
  };
  for (const [key, value] of Object.entries(settings))
    await db.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["tax.vatRate", "payment.defaultPolicy"] } } });

  const categories: [string, string[]][] = [
    ["طباعة تجارية وورقية", ["تجهيز الملفات", "الطباعة", "القص", "التغليف", "الفحص النهائي"]],
    ["أكياس وعلب وتغليف", ["تجهيز الملفات", "تجهيز الخامات", "الطباعة", "القص", "التشكيل", "التجميع", "التغليف", "الفحص النهائي"]],
    ["لوحات إعلانية", ["تجهيز الملفات", "تجهيز الخامات", "الطباعة", "القص", "التجميع", "الفحص النهائي"]],
    ["استيكرات وملصقات", ["تجهيز الملفات", "الطباعة", "القص", "التغليف"]],
    ["بنرات وفينيل", ["تجهيز الملفات", "الطباعة", "التشطيب", "التغليف"]],
    ["طباعة UV و DTF UV", ["تجهيز الملفات", "الطباعة", "الفحص النهائي"]],
    ["هدايا دعائية", ["تجهيز الملفات", "الطباعة", "التغليف"]],
  ];
  for (const [name, defaultStages] of categories) await db.productCategory.upsert({ where: { name }, update: { defaultStages }, create: { name, defaultStages } });

  const machines: [string, string, string, number, string][] = [
    ["M-01", "أوفست هايدلبرغ SM74", "طباعة أوفست", 8000, "فرخ/ساعة"],
    ["M-02", "طابعة UV مسطحة", "UV", 25, "م²/ساعة"],
    ["M-03", "طابعة DTF UV", "DTF UV", 15, "م²/ساعة"],
    ["M-04", "مقص ورق هيدروليكي", "قص", 3000, "فرخ/ساعة"],
    ["M-05", "ماكينة تكسير وتشكيل علب", "تشكيل", 1500, "قطعة/ساعة"],
    ["M-06", "بلوتر قص فينيل", "قص فينيل", 20, "م²/ساعة"],
  ];
  if (demo) for (const [code, name, type, cap, unit] of machines)
    await db.machine.upsert({ where: { code }, update: {}, create: { code, name, type, capacityPerHour: cap, capacityUnit: unit, branchId: branch.id } });

  if (!demo) console.log("✓ Seed (إنتاج): الصلاحيات والأدوار والإعدادات وحساب admin — أضف الموظفين والآلات من داخل النظام");

  if (!(await db.liveBoardDevice.count())) {
    const token = randomBytes(24).toString("base64url");
    await db.liveBoardDevice.create({ data: { name: "شاشة صالة الإنتاج", tokenHash: createHash("sha256").update(token).digest("hex"), config: DEFAULT_BOARD_CONFIG as never } });
    console.log(`\n📺 رابط شاشة الإنتاج المباشر (احفظه، لن يظهر مرة أخرى):\n   /live-board?device=${token}\n`);
  }
  console.log("✓ Seed complete — المستخدم: admin");
}
main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });

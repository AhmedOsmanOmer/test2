/** تكامل notify(): يعمل فقط مع TEST_DATABASE_URL على المنفذ 5434 (بعد seed تجريبي) */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const enabled = !!url && new URL(url).port === "5434";

describe.skipIf(!enabled)("تكامل: notify() — المنفّذ، المعطّلون، النطاق، منع التكرار", () => {
  let db: typeof import("@/lib/db").db;
  let notify: typeof import("@/server/services/audit").notify;
  let U: Record<string, string>;
  let orderId: string;
  const type = `T_${Date.now()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ db } = await import("@/lib/db"));
    ({ notify } = await import("@/server/services/audit"));
    U = {};
    for (const u of ["admin", "ops", "salessup", "sales", "sales2", "designer"]) U[u] = (await db.user.findUniqueOrThrow({ where: { username: u } })).id;
    const role = await db.role.findUniqueOrThrow({ where: { key: "SALES" } });
    U.inactive = (await db.user.create({ data: { username: `inactive${Date.now()}`, fullName: "معطّل", passwordHash: "x", isActive: false, roles: { create: { roleId: role.id } } } })).id;
    orderId = (await db.order.findFirstOrThrow({ where: { salesRepId: U.sales } })).id;
  });
  afterAll(async () => { await db?.$disconnect(); });
  const got = async (t: string) => (await db.notification.findMany({ where: { type: t }, select: { userId: true } })).map((n) => n.userId).sort();

  it("يستثني المنفّذ والمعطّلين ومندوب طلب آخر، ولا يكرر المستخدم", async () => {
    await notify(db, { type, title: "اختبار", orderId, actorId: U.ops, roles: ["SALES", "OPERATIONS_MANAGER"], userIds: [U.sales, U.sales, U.inactive, U.designer] });
    const r = await got(type);
    expect(r).toContain(U.sales);
    expect(r).toContain(U.designer);
    expect(r).not.toContain(U.ops);       // المنفّذ
    expect(r).not.toContain(U.inactive);  // معطّل
    expect(r).not.toContain(U.sales2);    // مبيعات ليس مندوب الطلب
    expect(r.filter((x) => x === U.sales)).toHaveLength(1);
  });

  it("داخل المعاملة: الإشعار الأخص يغلب إشعار تغيير الحالة العام (بأي ترتيب)", async () => {
    const g = `${type}_G`, s1 = `${type}_S1`, s2 = `${type}_S2`;
    await db.$transaction(async (tx) => {
      await notify(tx, { type: s1, title: "أخص قبل", orderId, userIds: [U.sales] });
      await notify(tx, { type: g, title: "عام", orderId, userIds: [U.sales, U.salessup, U.admin], generic: true });
      await notify(tx, { type: s2, title: "أخص بعد", orderId, userIds: [U.admin] });
    });
    expect(await got(s1)).toEqual([U.sales]);
    expect(await got(g)).toEqual([U.salessup]);
    expect(await got(s2)).toEqual([U.admin]);
    expect((await db.notification.findFirstOrThrow({ where: { type: s1 } })).orderId).toBe(orderId);
  });
});

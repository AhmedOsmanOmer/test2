import { describe, it, expect } from "vitest";
import { EVENT_RULES, statusChangeRule, statusChangeText, planRecipients, effectivePermissions, mayReceiveOrderNotification, ALERT_STATUSES, type OrderEventKind } from "@/lib/notification-rules";
import { ROLES, type PermissionKey } from "@/lib/permissions";

// مستخدمون وهميون: دور واحد لكل مستخدم
const members = [
  { id: "admin", roles: ["SUPER_ADMIN"] }, { id: "ops", roles: ["OPERATIONS_MANAGER"] }, { id: "sup", roles: ["SALES_SUPERVISOR"] },
  { id: "salesA", roles: ["SALES"] }, { id: "salesB", roles: ["SALES"] }, { id: "designer", roles: ["DESIGNER"] },
  { id: "worker", roles: ["PRODUCTION_WORKER"] }, { id: "delivery", roles: ["DELIVERY"] },
];
const plan = (kind: OrderEventKind, actorId = "x") => planRecipients({ rule: EVENT_RULES[kind], repId: "salesA", assigneeIds: ["designer", "worker"], roleMembers: members, exclude: [actorId] }).sort();

describe("مصفوفة مستلمي أحداث الطلب", () => {
  it.each([
    ["ORDER_NEW", ["admin", "ops", "salesA", "sup"]],
    ["ORDER_STATUS_CHANGED", ["ops", "salesA", "sup"]],
    ["DEPOSIT_RECEIVED", ["ops", "salesA"]],
    ["ORDER_REP_CHANGED", ["ops", "salesA"]],
    ["ORDER_DUE_CHANGED", ["designer", "ops", "salesA", "sup", "worker"]],
    ["ORDER_COMMENT", ["designer", "salesA", "worker"]],
    ["DUE_SOON", ["designer", "ops", "salesA", "sup", "worker"]],
    ["ORDER_LATE", ["admin", "designer", "ops", "salesA", "sup", "worker"]],
  ] as [OrderEventKind, string[]][])("%s", (kind, expected) => {
    expect(plan(kind)).toEqual(expected);
    expect(plan(kind)).not.toContain("salesB");
  });
  it("الحالات الاستثنائية مهمة وتصل للمدير العام والمكلّفين", () => {
    for (const s of ALERT_STATUSES) {
      const r = statusChangeRule(s);
      expect(r.important).toBe(true);
      expect(planRecipients({ rule: r, repId: "salesA", assigneeIds: ["worker"], roleMembers: members }).sort()).toEqual(["admin", "ops", "salesA", "sup", "worker"]);
    }
    expect(statusChangeRule("IN_DESIGN")).toEqual(EVENT_RULES.ORDER_STATUS_CHANGED);
  });
  it("المنفّذ لا يُشعَر بفعله، والمستلم يظهر مرة واحدة", () => {
    expect(plan("ORDER_COMMENT", "salesA")).toEqual(["designer", "worker"]);
    const twice = planRecipients({ rule: EVENT_RULES.ORDER_LATE, repId: "ops", assigneeIds: ["ops", "ops"], roleMembers: members, extra: ["ops"] });
    expect(twice.filter((x) => x === "ops")).toHaveLength(1);
  });
  it("نص تغيير الحالة بلا أرقام مالية ويقص السبب عند 120 حرفًا", () => {
    const t = statusChangeText("GP-2026-0001", "مراجعة الطلب", "معلق", "س".repeat(200));
    expect(t.title).toBe("الطلب GP-2026-0001: مراجعة الطلب ← معلق");
    expect(t.body!.length).toBe(120);
    expect(statusChangeText("GP-1", "أ", "ب", "  ").body).toBeUndefined();
  });
});

describe("الصلاحيات الفعلية وتصفية المستلمين حسب نطاق الطلب", () => {
  const sales = (id: string) => ({ id, permissions: new Set<PermissionKey>(ROLES.SALES.permissions) });
  it("موظف المبيعات يستلم إشعارات طلباته فقط، وغيره يستلم الكل", () => {
    expect(mayReceiveOrderNotification(sales("a"), { salesRepId: "a" })).toBe(true);
    expect(mayReceiveOrderNotification(sales("b"), { salesRepId: "a" })).toBe(false);
    expect(mayReceiveOrderNotification({ id: "w", permissions: new Set<PermissionKey>(ROLES.PRODUCTION_WORKER.permissions) }, { salesRepId: "a" })).toBe(true);
  });
  it("المنح والسحب الاستثنائي مع تجاهل المنتهي", () => {
    const past = new Date(Date.now() - 1000), future = new Date(Date.now() + 86400_000);
    const p = effectivePermissions(["orders.view"], [{ key: "orders.view_all", granted: true, expiresAt: future }, { key: "orders.view", granted: false, expiresAt: past }]);
    expect([...p].sort()).toEqual(["orders.view", "orders.view_all"]);
  });
});

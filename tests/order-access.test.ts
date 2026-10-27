import { describe, it, expect } from "vitest";
import { orderScope, inOrderScope, orderMoneyView } from "@/lib/order-access";
import { ROLES, type PermissionKey } from "@/lib/permissions";

const actor = (role: string, id = role.toLowerCase()) => ({ id, permissions: new Set<PermissionKey>(ROLES[role].permissions) });
const order = { salesRepId: "rep-a", total: "1500.50", paidAmount: "500.25" };

describe("orderScope / inOrderScope", () => {
  it("المبيعات مقيد بطلباته، وغيره يرى الكل", () => {
    expect(orderScope(actor("SALES", "rep-a"))).toEqual({ salesRepId: "rep-a" });
    for (const r of Object.keys(ROLES).filter((r) => r !== "SALES")) expect(orderScope(actor(r))).toEqual({});
  });
  it("الوصول لطلب محدد", () => {
    expect(inOrderScope(actor("SALES", "rep-a"), order)).toBe(true);
    expect(inOrderScope(actor("SALES", "rep-b"), order)).toBe(false);
    expect(inOrderScope(actor("PRODUCTION_WORKER"), order)).toBe(true);
  });
});

describe("orderMoneyView", () => {
  it("يعيد القيمة والمدفوع والمتبقي لمن يملك orders.view_value", () => {
    for (const r of ["SUPER_ADMIN", "SALES_SUPERVISOR", "SALES"])
      expect(orderMoneyView(actor(r), order)).toEqual({ total: 1500.5, paidAmount: 500.25, remaining: 1000.25 });
  });
  it("null لكل الأدوار الأخرى", () => {
    for (const r of ["OPERATIONS_MANAGER", "DESIGNER", "PRODUCTION_SUPERVISOR", "PRODUCTION_WORKER", "QUALITY", "DELIVERY"])
      expect(orderMoneyView(actor(r), order)).toBeNull();
  });
});

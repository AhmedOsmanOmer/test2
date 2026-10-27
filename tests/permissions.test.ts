import { describe, it, expect } from "vitest";
import { ROLES, PERMISSIONS, MONEY_PERMISSIONS, type PermissionKey } from "@/lib/permissions";

const has = (role: string, p: PermissionKey) => ROLES[role].permissions.includes(p);
const rolesWith = (p: PermissionKey) => Object.keys(ROLES).filter((r) => has(r, p)).sort();

describe("مصفوفة الأدوار والصلاحيات", () => {
  it("الأدوار المحذوفة غير موجودة والدور الجديد موجود", () => {
    expect(ROLES.INVENTORY).toBeUndefined();
    expect(ROLES.ACCOUNTANT).toBeUndefined();
    expect(ROLES.SALES_SUPERVISOR.name).toBe("مشرف المبيعات");
  });
  it("كل صلاحية مسندة لدور موجودة في الكتالوج", () => {
    for (const r of Object.values(ROLES)) for (const p of r.permissions) expect(PERMISSIONS).toHaveProperty([p]);
  });
  it("لا توجد صلاحيات للوحدات المحذوفة في الكتالوج", () => {
    for (const k of ["prices.view", "profit.view", "payments.view", "payments.record", "payments.void", "quotations.manage", "inventory.view",
      "inventory.manage", "purchasing.manage", "invoices.manage", "reports.financial", "files.financial", "orders.override_deposit"])
      expect(Object.keys(PERMISSIONS)).not.toContain(k);
  });
  it("المؤشرات المالية وسجل التدقيق للمدير العام فقط", () => {
    expect(rolesWith("dashboard.financial")).toEqual(["SUPER_ADMIN"]);
    expect(rolesWith("audit.view")).toEqual(["SUPER_ADMIN"]);
  });
  it("المبيعات وحده لا يرى كل الطلبات", () => {
    const without = Object.keys(ROLES).filter((r) => !has(r, "orders.view_all"));
    expect(without).toEqual(["SALES"]);
  });
  it("مدير العمليات بلا أي صلاحية مالية", () => {
    for (const p of MONEY_PERMISSIONS) expect(has("OPERATIONS_MANAGER", p)).toBe(false);
    expect(has("OPERATIONS_MANAGER", "orders.view_all")).toBe(true);
  });
  it("رؤية القيمة وتعديلها للمدير العام ومشرف المبيعات والمبيعات فقط", () => {
    expect(rolesWith("orders.view_value")).toEqual(["SALES", "SALES_SUPERVISOR", "SUPER_ADMIN"]);
    expect(rolesWith("orders.edit_value")).toEqual(["SALES", "SALES_SUPERVISOR", "SUPER_ADMIN"]);
    expect(rolesWith("orders.set_deposit")).toEqual(["SALES_SUPERVISOR", "SUPER_ADMIN"]);
    expect(rolesWith("orders.reassign")).toEqual(["SALES_SUPERVISOR", "SUPER_ADMIN"]);
    expect(rolesWith("orders.import_items")).toEqual(["SALES", "SALES_SUPERVISOR", "SUPER_ADMIN"]);
  });
  it("مشرف المبيعات = صلاحيات المبيعات + الإشراف، بلا إدارة", () => {
    for (const p of ROLES.SALES.permissions) expect(has("SALES_SUPERVISOR", p)).toBe(true);
    for (const p of ["orders.view_all", "orders.view_value", "orders.edit_value", "orders.set_deposit", "orders.change_status", "orders.close"] as const)
      expect(has("SALES_SUPERVISOR", p)).toBe(true);
    for (const p of ["dashboard.financial", "audit.view", "users.manage", "settings.manage"] as const) expect(has("SALES_SUPERVISOR", p)).toBe(false);
  });
  it("المبيعات: صلاحيات محددة فقط", () => {
    expect([...ROLES.SALES.permissions].sort()).toEqual([
      "customers.contact", "customers.manage", "customers.view", "dashboard.view", "delivery.view", "design.view", "files.upload", "files.view",
      "orders.change_status", "orders.create", "orders.edit", "orders.edit_value", "orders.import_items", "orders.view", "orders.view_value", "production.view",
    ]);
  });
  it("المدير العام يملك كل الصلاحيات", () => {
    expect([...ROLES.SUPER_ADMIN.permissions].sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });
});

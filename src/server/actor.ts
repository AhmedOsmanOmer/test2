import type { PermissionKey } from "@/lib/permissions";
import { forbidden } from "@/lib/errors";
import { db } from "@/lib/db";
import { effectivePermissions } from "@/lib/notification-rules";

export interface Actor {
  id: string;
  fullName: string;
  username: string;
  roles: string[];
  permissions: Set<PermissionKey>;
  branchId: string | null;
  mustChangePassword: boolean;
}

export const can = (a: Actor, p: PermissionKey) => a.permissions.has(p);
export function requirePerm(a: Actor, ...perms: PermissionKey[]) {
  for (const p of perms) if (!a.permissions.has(p)) throw forbidden();
}
export function requireAny(a: Actor, ...perms: PermissionKey[]) {
  if (!perms.some((p) => a.permissions.has(p))) throw forbidden();
}

/** يبني صلاحيات المستخدم الفعلية: صلاحيات الأدوار + المنح الاستثنائية − السحب */
export async function loadActor(userId: string): Promise<Actor | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      permissionOverrides: { include: { permission: true } },
    },
  });
  if (!u || !u.isActive) return null;
  const perms = effectivePermissions(
    u.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key)),
    u.permissionOverrides.map((o) => ({ key: o.permission.key, granted: o.granted, expiresAt: o.expiresAt })),
  );
  return { id: u.id, fullName: u.fullName, username: u.username, roles: u.roles.map((r) => r.role.key), permissions: perms, branchId: u.branchId, mustChangePassword: u.mustChangePassword };
}

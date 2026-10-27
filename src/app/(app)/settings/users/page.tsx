import { requireActor, pagePerm } from "@/server/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Badge, TableScroll } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { toggleUserAction, resetPasswordAction } from "@/server/actions";
import { dateTime } from "@/lib/format";
import { NewUser } from "./form";

export default async function Users() {
  const a = await requireActor(); pagePerm(a, "users.manage");
  const [users, roles] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { roles: { include: { role: true } }, permissionOverrides: { include: { permission: true } } } }),
    db.role.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" subtitle="الصلاحيات تُطبَّق على الخادم في كل صفحة وإجراء" />
      <Card>
        <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">المستخدم</th><th className="th">الاسم</th><th className="th">الدور</th><th className="th">صلاحيات استثنائية</th><th className="th">آخر دخول</th><th className="th">الحالة</th><th className="th"></th></tr></thead>
          <tbody>{users.map((u) => <tr key={u.id} className="border-b border-paper-line/60">
            <td className="td" dir="ltr">{u.username}</td><td className="td">{u.fullName}</td><td className="td">{u.roles.map((r) => r.role.name).join("، ")}</td>
            <td className="td text-xs">{u.permissionOverrides.map((o) => `${o.granted ? "+" : "−"} ${o.permission.name}`).join("، ") || "—"}</td>
            <td className="td">{dateTime(u.lastLoginAt)}</td>
            <td className="td">{u.isActive ? (u.lockedUntil && u.lockedUntil > new Date() ? <Badge tone="yellow">مقفل مؤقتًا</Badge> : <Badge tone="green">نشط</Badge>) : <Badge tone="red">معطل</Badge>}</td>
            <td className="td"><span className="flex gap-2">
              {u.id !== a.id && <ActionButton confirm={u.isActive ? "تعطيل الحساب وإنهاء جلساته؟" : "تفعيل الحساب؟"} action={toggleUserAction.bind(null, u.id)}>{u.isActive ? "تعطيل" : "تفعيل"}</ActionButton>}
              <ActionButton askReason="كلمة المرور الجديدة (10 أحرف على الأقل):" action={resetPasswordAction.bind(null, u.id)}>إعادة تعيين كلمة المرور</ActionButton>
            </span></td></tr>)}</tbody></table></TableScroll>
      </Card>
      <div className="mt-4"><Card title="حساب جديد"><NewUser roles={roles.map((r) => ({ key: r.key, name: r.name }))} /></Card></div>
      <p className="mt-3 text-xs text-ink-faint">تعديل صلاحيات الأدوار ومنح الصلاحيات الاستثنائية من الواجهة ضمن المرحلة التالية؛ البنية (UserPermissionOverride) تعمل ومختبرة في الخادم.</p>
    </>
  );
}

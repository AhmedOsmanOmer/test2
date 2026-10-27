import { requireActor } from "@/server/auth";
import { can } from "@/server/actor";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/permissions";
import type { NavItem } from "@/components/sidebar";
import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const a = await requireActor();
  if (a.mustChangePassword) redirect("/account/password");
  const unread = await db.notification.count({ where: { userId: a.id, readAt: null } });
  const nav: (NavItem & { show: boolean })[] = [
    { href: "/", label: "لوحة التحكم", icon: "LayoutDashboard", show: can(a, "dashboard.view") },
    { href: "/my", label: "مهامي", icon: "ListChecks", show: true },
    { href: "/customers", label: "العملاء", icon: "Users", show: can(a, "customers.view") },
    { href: "/orders", label: "الطلبات", icon: "ClipboardList", show: can(a, "orders.view") },
    { href: "/design", label: "التصميم", icon: "PenTool", show: can(a, "design.view") },
    { href: "/production", label: "الإنتاج", icon: "Factory", show: can(a, "production.view") },
    { href: "/live-board", label: "شاشة الإنتاج المباشر", icon: "MonitorPlay", show: can(a, "production.view"), external: true },
    { href: "/quality", label: "الجودة", icon: "BadgeCheck", show: can(a, "quality.inspect") },
    { href: "/delivery", label: "التسليم", icon: "Truck", show: can(a, "delivery.view") },
    { href: "/notifications", label: "الإشعارات", icon: "Bell", show: true, badge: unread },
    { href: "/settings", label: "الإعدادات", icon: "Settings", show: can(a, "settings.manage") || can(a, "users.manage") || can(a, "liveboard.manage") || can(a, "machines.manage") || can(a, "audit.view") },
  ];
  return (
    <>
      <AppShell items={nav.filter((n) => n.show)} user={{ name: a.fullName, role: a.roles.map((r) => ROLES[r]?.name ?? r).join("، ") }} unread={unread}>
        {children}
      </AppShell>
      <script dangerouslySetInnerHTML={{ __html: `document.addEventListener('keydown',function(e){if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){var s=document.getElementById('global-search');if(s&&s.offsetParent){e.preventDefault();s.focus()}}})` }} />
    </>
  );
}

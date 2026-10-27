"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, ClipboardList, PenTool, Factory, MonitorPlay, BadgeCheck, Truck, Bell, Settings, ListChecks } from "lucide-react";
import clsx from "clsx";

const ICONS = { LayoutDashboard, Users, ClipboardList, PenTool, Factory, MonitorPlay, BadgeCheck, Truck, Bell, Settings, ListChecks };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; external?: boolean };

/** محتوى القائمة الجانبية — نفسه في الشريط الثابت على سطح المكتب وفي الدرج على الجوال */
export function SidebarPanel({ items, user, top, onNavigate }: { items: NavItem[]; user: { name: string; role: string }; top?: React.ReactNode; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="cmyk-strip h-1.5 shrink-0" />
      <div className="px-5 py-5">
        <div className="text-lg font-bold leading-tight">بوابة الطباعة</div>
        <div className="text-xs text-white/50" dir="ltr">Printing gate ERP</div>
      </div>
      {top}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="التنقل الرئيسي">
        {items.map((it) => {
          const Icon = ICONS[it.icon];
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} target={it.external ? "_blank" : undefined} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={clsx("flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm transition lg:min-h-0", active ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white")}>
              <Icon size={17} strokeWidth={1.8} aria-hidden />
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className="rounded bg-magenta-process px-1.5 text-xs">{it.badge}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
        <div className="font-medium wrap-anywhere">{user.name}</div>
        <div className="text-xs text-white/50">{user.role}</div>
      </div>
    </div>
  );
}

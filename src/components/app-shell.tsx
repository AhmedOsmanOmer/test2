"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, UserRound, Search } from "lucide-react";
import { SidebarPanel, type NavItem } from "./sidebar";
import { NotificationBell } from "./notification-bell";
import { logoutAction } from "@/server/actions";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
const toggleTheme = () => {
  const d = document.documentElement.classList.toggle("dark");
  try { localStorage.setItem("gp-theme", d ? "dark" : "light"); } catch { /* تجاهل */ }
};

/**
 * هيكل التطبيق المتجاوب:
 * - سطح المكتب (≥1024px): قائمة جانبية ثابتة + ترويسة فيها البحث والجرس والروابط.
 * - الجوال واللوحي: شريط علوي ثابت (زر القائمة، الاسم، الجرس، قائمة المستخدم) ودرج جانبي ينزلق من اليمين.
 *   الدرج يُغلق عند التنقل والنقر على الخلفية وEscape، ويحصر التركيز داخله أثناء فتحه.
 * ترويسة واحدة فقط (والجرس مرة واحدة) حتى لا يتكرر الاستطلاع.
 */
export function AppShell({ items, user, unread, children }: { items: NavItem[]; user: { name: string; role: string }; unread: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const drawer = useRef<HTMLDivElement>(null);
  const burger = useRef<HTMLButtonElement>(null);
  const userBox = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setOpen(false); burger.current?.focus(); }, []);
  useEffect(() => { setOpen(false); setMenu(false); }, [pathname]);

  useEffect(() => {
    const el = drawer.current;
    if (el) (el as HTMLElement & { inert: boolean }).inert = !open;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    setTimeout(() => first?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !el) return;
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!list.length) return;
      const a = list[0], z = list[list.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
      else if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (userBox.current && !userBox.current.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  const search = (id: string) => (
    <form action="/search" role="search" className="relative">
      <Search size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-ink-faint" aria-hidden />
      <input name="q" id={id} className="input ps-9" placeholder="بحث: رقم طلب، عميل، جوال…" aria-label="بحث" />
    </form>
  );

  return (
    <div className="flex min-h-screen">
      {/* سطح المكتب: قائمة جانبية ثابتة */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 lg:block"><SidebarPanel items={items} user={user} /></aside>

      {/* الجوال واللوحي: درج جانبي من جهة البداية (اليمين في RTL) */}
      <div className={`no-print fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={close} aria-hidden="true" data-testid="drawer-backdrop" />
      <div id="app-drawer" ref={drawer} role="dialog" aria-modal="true" aria-label="القائمة الرئيسية" aria-hidden={!open}
        className={`no-print fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] pt-[env(safe-area-inset-top)] shadow-2xl transition-[transform,visibility] duration-200 lg:hidden ${open ? "visible translate-x-0" : "invisible translate-x-full"}`}>
        <div className="relative h-full bg-ink">
          <button type="button" onClick={close} className="absolute end-2 top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-md text-white/80 hover:bg-white/10" aria-label="إغلاق القائمة"><X size={20} /></button>
          <SidebarPanel items={items} user={user} onNavigate={() => setOpen(false)} top={<div className="px-3 pb-3">{search("drawer-search")}</div>} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-paper-line bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="safe-x flex min-h-[56px] items-center gap-2 py-2 lg:gap-3 lg:py-3">
            <button ref={burger} type="button" className="btn-ghost h-11 w-11 shrink-0 p-0 lg:hidden" aria-label="فتح القائمة" aria-controls="app-drawer" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} /></button>
            <Link href="/" className="min-w-0 flex-1 truncate font-bold lg:hidden">بوابة الطباعة</Link>
            <div className="hidden max-w-md flex-1 lg:block">{search("global-search")}</div>
            <div className="hidden flex-1 lg:block" />
            <NotificationBell initialUnread={unread} />
            <Link href="/account/password" className="btn-ghost hidden lg:inline-flex">كلمة المرور</Link>
            <button type="button" className="btn-ghost hidden px-2.5 lg:inline-flex" title="الوضع الفاتح/الداكن" onClick={toggleTheme}>◐</button>
            <form action={logoutAction} className="hidden lg:block"><button className="btn-ghost">خروج</button></form>
            {/* الجوال: قائمة المستخدم */}
            <div className="relative lg:hidden" ref={userBox}>
              <button type="button" className="btn-ghost h-11 w-11 p-0" aria-label="قائمة المستخدم" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><UserRound size={20} /></button>
              {menu && (
                <div role="menu" className="card absolute end-0 z-40 mt-2 w-60 max-w-[calc(100vw-1.5rem)] p-1 shadow-lg">
                  <div className="border-b border-paper-line px-3 py-2 text-sm"><div className="font-medium wrap-anywhere">{user.name}</div><div className="text-xs text-ink-soft">{user.role}</div></div>
                  <Link role="menuitem" href="/account/password" className="flex min-h-[44px] items-center rounded px-3 text-sm hover:bg-paper">كلمة المرور</Link>
                  <button role="menuitem" type="button" className="flex min-h-[44px] w-full items-center rounded px-3 text-sm hover:bg-paper" onClick={toggleTheme}>الوضع الفاتح/الداكن</button>
                  <form action={logoutAction}><button role="menuitem" className="flex min-h-[44px] w-full items-center rounded px-3 text-sm text-magenta-process hover:bg-paper">خروج</button></form>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="safe-x min-w-0 flex-1 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-6">{children}</main>
      </div>
    </div>
  );
}

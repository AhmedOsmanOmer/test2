"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { markNotificationsReadAction } from "@/server/actions";

type Item = { id: string; title: string; body: string | null; link: string | null; isImportant: boolean; readAt: string | null; createdAt: string };
type Poll = { unread: number; items: Item[]; latestId: string | null; fresh: boolean };

const VISIBLE_MS = 15_000, HIDDEN_MS = 60_000;
const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("ar", { numeric: "auto" }) : null;
function relTime(iso: string) {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (!rtf) return "";
  if (abs < 60) return rtf.format(Math.round(s), "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
const pref = {
  get: (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } },
  set: (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* التفضيل اختياري */ } },
};
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.15); o.onended = () => ctx.close();
  } catch { /* بلا صوت */ }
}
const openHref = (id: string) => `/notifications/${id}/open`;

/** جرس الإشعارات في الترويسة: استطلاع دوري، قائمة آخر 10، تنبيه منبثق، عدد في عنوان الصفحة */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Item[]>([]);
  const [sound, setSound] = useState(false);
  const [browser, setBrowser] = useState<"off" | "on" | "denied" | "unsupported">("off");
  const latest = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inFlight = useRef(false);
  const baseTitle = useRef("");
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const prefs = useRef({ sound: false, browser: false });

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch(`/api/notifications/poll${latest.current ? `?after=${encodeURIComponent(latest.current)}` : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      const d: Poll = await r.json();
      setUnread(d.unread);
      if (d.fresh) {
        if (d.items.length) {
          setItems((xs) => [...d.items, ...xs.filter((x) => !d.items.some((n) => n.id === x.id))].slice(0, 10));
          setToasts((ts) => [...d.items.slice(0, 3), ...ts].slice(0, 3));
          if (prefs.current.sound) beep();
          if (prefs.current.browser && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted")
            for (const n of d.items.filter((x) => x.isImportant).slice(0, 3)) {
              try { const bn = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, lang: "ar", dir: "rtl" }); bn.onclick = () => { window.focus(); window.location.href = openHref(n.id); }; } catch { /* غير مدعوم */ }
            }
        }
      } else setItems(d.items);
      if (d.latestId) latest.current = d.latestId;
    } catch { /* الشبكة: المحاولة التالية */ } finally { inFlight.current = false; }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { await poll(); schedule(); }, document.hidden ? HIDDEN_MS : VISIBLE_MS);
  }, [poll]);
  const pollNow = useCallback(async () => { await poll(); schedule(); }, [poll, schedule]);

  useEffect(() => {
    prefs.current = { sound: pref.get("gp-notif-sound"), browser: pref.get("gp-notif-browser") };
    setSound(prefs.current.sound);
    setBrowser(typeof Notification === "undefined" ? "unsupported" : Notification.permission === "denied" ? "denied" : prefs.current.browser && Notification.permission === "granted" ? "on" : "off");
    void pollNow();
    const onVis = () => { if (!document.hidden) void pollNow(); else schedule(); };
    const onFocus = () => void pollNow();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    // بعد أي إجراء خادم (طلبات Next-Action) نستطلع فورًا
    const orig = window.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      const res = await orig(input, init);
      try {
        const h = init?.headers;
        const isAction = h instanceof Headers ? h.has("Next-Action") : Array.isArray(h) ? h.some(([k]) => k.toLowerCase() === "next-action") : !!h && Object.keys(h).some((k) => k.toLowerCase() === "next-action");
        if (isAction) setTimeout(() => void pollNow(), 300);
      } catch { /* تجاهل */ }
      return res;
    };
    window.fetch = wrapped;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      if (window.fetch === wrapped) window.fetch = orig;
    };
  }, [pollNow, schedule]);

  // (n) قبل عنوان الصفحة؛ يُعاد تطبيقه بعد كل تنقل لأن Next يعيد ضبط العنوان
  useEffect(() => {
    const strip = (t: string) => t.replace(/^\(\d+\)\s*/, "");
    baseTitle.current = strip(document.title);
    document.title = unread > 0 ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread, pathname]);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((ts) => ts.slice(0, -1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  const markAll = async () => {
    const r = await markNotificationsReadAction();
    if (r.ok) { setUnread(0); setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() }))); router.refresh(); }
  };
  const toggleSound = () => { const v = !sound; setSound(v); prefs.current.sound = v; pref.set("gp-notif-sound", v); if (v) beep(); };
  const enableBrowser = async () => {
    if (typeof Notification === "undefined") return setBrowser("unsupported");
    if (browser === "on") { prefs.current.browser = false; pref.set("gp-notif-browser", false); return setBrowser("off"); }
    let p = Notification.permission;
    try { if (p === "default") p = await Notification.requestPermission(); } catch { /* متصفح قديم */ }
    const on = p === "granted";
    prefs.current.browser = on; pref.set("gp-notif-browser", on);
    setBrowser(on ? "on" : p === "denied" ? "denied" : "off");
  };

  return (
    <div className="relative" ref={box}>
      <button type="button" className="btn-ghost relative h-11 w-11 p-0 lg:h-auto lg:w-auto lg:px-2.5" aria-expanded={open} aria-haspopup="dialog" aria-label={`الإشعارات${unread ? ` (${unread} غير مقروء)` : ""}`} data-testid="bell"
        onClick={() => { setOpen((o) => !o); if (!open) void pollNow(); }}>
        <Bell size={18} strokeWidth={1.8} />
        {unread > 0 && <span data-testid="bell-count" className="absolute -top-1 -start-1 min-w-[1.25rem] rounded-full bg-magenta-process px-1 text-center text-[11px] leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        // الجوال: لوحة بعرض الشاشة تحت الشريط العلوي؛ من 640px: قائمة منسدلة بعرض 24rem
        <div data-testid="bell-panel" role="dialog" aria-label="الإشعارات"
          className="card fixed inset-x-2 top-[calc(3.75rem+env(safe-area-inset-top))] z-40 overflow-hidden p-0 shadow-lg sm:absolute sm:inset-x-auto sm:end-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-paper-line px-3 py-2 text-sm">
            <b>الإشعارات</b>
            <span className="flex gap-3">
              {unread > 0 && <button type="button" className="min-h-[44px] text-cyan-deep lg:min-h-0" onClick={markAll}>تعليم الكل كمقروء</button>}
              <a href="/notifications" className="inline-flex min-h-[44px] items-center text-cyan-deep lg:min-h-0">عرض الكل</a>
            </span>
          </div>
          <ul className="max-h-[60vh] divide-y sm:max-h-96 divide-paper-line overflow-y-auto">
            {items.length ? items.map((x) => (
              <li key={x.id}>
                <a href={openHref(x.id)} className={`flex min-h-[44px] gap-2 px-3 py-2 text-sm hover:bg-paper ${x.readAt ? "opacity-60" : ""}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.readAt ? "bg-transparent" : "bg-cyan-process"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block wrap-anywhere ${x.isImportant ? "font-semibold" : ""}`}>{x.title}</span>
                    {x.body && <span className="block truncate text-xs text-ink-soft">{x.body}</span>}
                    <span className="block text-xs text-ink-faint">{relTime(x.createdAt)}</span>
                  </span>
                </a>
              </li>)) : <li className="px-3 py-6 text-center text-sm text-ink-soft">لا توجد إشعارات</li>}
          </ul>
          <div className="space-y-1 border-t border-paper-line px-3 py-2 text-xs text-ink-soft">
            <label className="flex min-h-[44px] items-center gap-2 lg:min-h-0"><input type="checkbox" className="h-4 w-4" checked={sound} onChange={toggleSound} /> صوت عند وصول إشعار جديد</label>
            {browser !== "unsupported" && <div className="flex items-center justify-between gap-2">
              <button type="button" className="min-h-[44px] text-cyan-deep lg:min-h-0" onClick={enableBrowser}>{browser === "on" ? "إيقاف تنبيهات المتصفح" : "تفعيل تنبيهات المتصفح"}</button>
              {browser === "denied" && <span className="text-magenta-process">مرفوضة من إعدادات المتصفح</span>}
            </div>}
            <p>تنبيهات المتصفح للإشعارات المهمة فقط وعندما تكون الصفحة في الخلفية، وتعمل على localhost أو عبر HTTPS.</p>
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] start-4 end-4 z-40 space-y-2 sm:end-auto sm:w-80" role="status" aria-live="polite">
          {toasts.map((t) => (
            <a key={t.id} href={openHref(t.id)} className={`card block min-h-[44px] p-3 text-sm shadow-lg wrap-anywhere ${t.isImportant ? "border-s-4 border-s-magenta-process" : ""}`}>
              <span className="block font-medium">{t.title}</span>
              {t.body && <span className="block truncate text-xs text-ink-soft">{t.body}</span>}
            </a>))}
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardConfig, BoardData, BoardRow, Health } from "@/server/services/liveboard";

type Payload = { config: BoardConfig; name: string; data: BoardData };
type Alert = { id: number; text: string; tone: Health };
const PR: Record<string, string> = { LOW: "منخفضة", NORMAL: "عادية", HIGH: "عالية", URGENT: "عاجلة" };
const MS: Record<string, [string, Health]> = { RUNNING: ["تعمل", "onTrack"], AVAILABLE: ["متاحة", "scheduled"], STOPPED: ["متوقفة", "late"], MAINTENANCE: ["تحت الصيانة", "atRisk"] };
const HL: Record<Health, string> = { onTrack: "حسب الجدول", atRisk: "معرض للتأخير", late: "متأخر", scheduled: "مجدول", stopped: "متوقف" };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "—");
const dur = (m?: number) => (m === undefined ? "—" : m >= 1440 ? `${Math.floor(m / 1440)} يوم ${Math.floor((m % 1440) / 60)} س` : m >= 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m} د`);

/** يقارن البيانات السابقة بالجديدة ليعرض أحداث: عاجل جديد، تعطل آلة، تأخر، اكتمال */
function diff(prev: BoardData | null, next: BoardData): string[][] {
  if (!prev) return [];
  const out: string[][] = [];
  const prevRefs = new Set([...prev.active, ...prev.next].map((r) => r.ref));
  for (const r of [...next.active, ...next.next]) if (!prevRefs.has(r.ref) && r.priority === "URGENT") out.push([`طلب إنتاج عاجل: ${r.ref} — ${r.product}`, "late"]);
  const prevLate = new Set(prev.late.map((r) => r.ref));
  for (const r of next.late) if (!prevLate.has(r.ref)) out.push([`تأخر: ${r.ref} في مرحلة ${r.stage}`, "late"]);
  for (const m of next.machines) { const p = prev.machines.find((x) => x.name === m.name); if (p && p.status !== m.status && ["STOPPED", "MAINTENANCE"].includes(m.status)) out.push([`الآلة ${m.name}: ${MS[m.status][0]}`, "atRisk"]); }
  for (const r of next.active) { const p = prev.active.find((x) => x.ref === r.ref); if (p && p.stage !== r.stage) out.push([`${r.ref}: انتقل إلى مرحلة ${r.stage}`, "onTrack"]); }
  if (next.kpis.completedToday > prev.kpis.completedToday) out.push([`اكتمل إنتاج ${next.kpis.completedToday - prev.kpis.completedToday} أمر تشغيل`, "onTrack"]);
  for (const r of next.active) if (!prev.active.some((x) => x.ref === r.ref) && prev.next.some((x) => x.ref === r.ref)) out.push([`بدأ الإنتاج: ${r.ref}`, "scheduled"]);
  return out;
}

export function Board({ device }: { device: string | null }) {
  const [p, setP] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline" | "denied">("connecting");
  const [now, setNow] = useState(new Date());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const prev = useRef<BoardData | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const q = device ? `?device=${encodeURIComponent(device)}` : "";
    let es: EventSource | null = null; let poll: ReturnType<typeof setInterval> | undefined; let closed = false;
    const apply = (payload: Payload) => {
      const events = diff(prev.current, payload.data);
      prev.current = payload.data; setP(payload); setStatus("live");
      if (events.length) setAlerts((xs) => [...events.map(([text, tone], i) => ({ id: Date.now() + i, text, tone: tone as Health })), ...xs].slice(0, 6));
    };
    const fallbackPoll = (secs: number) => { // احتياطي إذا منع الشبكة البث
      clearInterval(poll);
      poll = setInterval(async () => {
        try { const r = await fetch(`/api/live-board${q}`, { cache: "no-store" }); if (r.status === 401) return setStatus("denied"); if (r.ok) apply(await r.json()); } catch { setStatus("offline"); }
      }, secs * 1000);
    };
    (async () => {
      const r = await fetch(`/api/live-board${q}`, { cache: "no-store" }).catch(() => null);
      if (!r) { setStatus("offline"); fallbackPoll(10); return; }
      if (r.status === 401) { setStatus("denied"); return; }
      const first: Payload = await r.json(); apply(first);
      if (closed) return;
      es = new EventSource(`/api/live-board/stream${q}`);
      es.addEventListener("board", (e) => apply(JSON.parse((e as MessageEvent).data)));
      es.onerror = () => setStatus("offline");
      es.onopen = () => setStatus("live");
      fallbackPoll(Math.max(30, first.config.refreshSeconds * 3));
    })();
    return () => { closed = true; es?.close(); clearInterval(poll); };
  }, [device]);
  useEffect(() => { if (!alerts.length) return; const t = setTimeout(() => setAlerts((xs) => xs.slice(0, -1)), 15000); return () => clearTimeout(t); }, [alerts]);

  if (status === "denied") return <Center>رابط الشاشة غير صالح أو تم إيقافه. اطلب رابطًا جديدًا من مدير النظام (الإعدادات ← شاشة الإنتاج).</Center>;
  if (!p) return <Center>جارٍ الاتصال بنظام الإنتاج…</Center>;
  const { data: d, config: c } = p;
  const color = (h: Health) => c.colors[h];

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-board-bg text-white lg:h-screen lg:overflow-hidden" style={{ fontSize: "clamp(14px, 1.05vw, 26px)" }}>
      <div className="cmyk-strip h-2 shrink-0" />
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-[1.4em] pb-[0.6em] pt-[max(0.6em,env(safe-area-inset-top))]">
        <div>
          <h1 className="text-[1.9em] font-bold leading-tight">شاشة الإنتاج المباشر</h1>
          <p className="text-[0.85em] text-white/50">بوابة الطباعة — {p.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[1.2em]">
          <span className="flex items-center gap-2 text-[0.85em]"><span className={`h-3 w-3 rounded-full ${status === "live" ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />{status === "live" ? "مباشر" : "إعادة الاتصال…"}</span>
          <div className="text-left" dir="ltr">
            <div className="text-[2.2em] font-bold tabular-nums leading-none">{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Riyadh" })}</div>
            <div className="text-[0.85em] text-white/60" dir="rtl">{now.toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" })}</div>
          </div>
          <button className="no-print min-h-[44px] rounded border border-white/20 px-3 py-1 text-[0.75em] text-white/60 hover:text-white lg:min-h-0" onClick={() => document.documentElement.requestFullscreen?.()}>ملء الشاشة</button>
        </div>
      </header>

      {alerts.length > 0 && (
        <div className="mx-[1.4em] mb-[0.6em] flex shrink-0 flex-wrap gap-[0.6em] overflow-hidden lg:flex-nowrap">
          {alerts.slice(0, 3).map((x) => <div key={x.id} className="rounded px-[0.9em] py-[0.35em] text-[1em] font-semibold text-black" style={{ background: color(x.tone) }}>{x.text}</div>)}
        </div>
      )}

      {c.sections.kpis && (
        <section className="grid shrink-0 grid-cols-2 gap-[0.8em] px-[1.4em] sm:grid-cols-3 lg:grid-cols-6">
          {([["قيد الإنتاج الآن", d.kpis.inProduction, "onTrack"], ["مكتملة اليوم", d.kpis.completedToday, "onTrack"], ["متأخرة", d.kpis.late, "late"], ["عاجلة", d.kpis.urgent, "atRisk"], ["المجدولة التالية", d.kpis.upcoming, "scheduled"], ["إنجاز اليوم", `${d.kpis.dailyProgress}%`, "onTrack"]] as [string, number | string, Health][]).map(([label, v, h]) => (
            <div key={label} className="rounded-lg border border-board-line bg-board-panel px-[1em] py-[0.6em]" style={{ borderTop: `4px solid ${color(h)}` }}>
              <div className="text-[0.95em] text-white/60">{label}</div>
              <div className="text-[2.6em] font-bold tabular-nums leading-tight">{v}</div>
            </div>))}
        </section>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-[0.8em] p-[1.4em] pt-[0.8em] lg:grid-cols-[2.2fr_1fr]">
        <div className="flex min-h-0 flex-col gap-[0.8em]">
          {c.sections.active && <Panel title="الطلبات قيد التنفيذ" count={d.active.length} grow>
            <AutoScroll on={c.autoScroll}>
              <Table rows={d.active} color={color} cols={["الطلب", "المنتج", "الكمية", "المرحلة", "المسؤول", "الآلة", "الإنجاز", "الانتهاء المتوقع", "الحالة"]}
                render={(r) => [<Ref key="r" r={r} />, r.product, r.quantity.toLocaleString("ar-SA"), r.stage, r.assignee, r.machine, <Bar key="b" v={r.progress} c={color(r.health)} />, time(r.eta), <Pill key="p" c={color(r.health)}>{HL[r.health]}</Pill>]} empty="لا توجد أعمال قيد التنفيذ حاليًا" />
            </AutoScroll>
          </Panel>}
          {c.sections.next && <Panel title="الطلبات التالية" count={d.next.length}>
            <Table rows={d.next.slice(0, 6)} color={color} cols={["الطلب", "المنتج", "الكمية", "الآلة", "البداية المتوقعة", "الأولوية"]}
              render={(r) => [<Ref key="r" r={r} />, r.product, r.quantity.toLocaleString("ar-SA"), r.machine, r.start ? time(r.start) : "غير مجدول", <Pill key="p" c={r.priority === "URGENT" ? color("late") : color("scheduled")}>{PR[r.priority]}</Pill>]} empty="لا توجد أعمال مجدولة" />
          </Panel>}
        </div>
        <div className="flex min-h-0 flex-col gap-[0.8em]">
          {c.sections.late && <Panel title="الطلبات المتأخرة" count={d.late.length} tone={d.late.length ? color("late") : undefined} grow>
            {d.late.length ? <ul className="space-y-[0.5em]">{d.late.map((r) => (
              <li key={r.ref} className="rounded border-s-4 bg-white/5 px-[0.8em] py-[0.4em]" style={{ borderColor: color("late") }}>
                <div className="flex justify-between font-semibold"><span>{r.orderNo} <span className="text-[0.8em] font-normal text-white/50">{r.prNo}</span></span><span style={{ color: color("late") }}>+{dur(r.delayMinutes)}</span></div>
                <div className="text-[0.9em] text-white/70">{r.stage} — {r.assignee} — المتوقع {time(r.eta)}</div>
              </li>))}</ul> : <p className="text-white/50">لا توجد طلبات متأخرة</p>}
          </Panel>}
          {c.sections.machines && <Panel title="حالة الآلات" count={d.machines.length}>
            <ul className="grid grid-cols-1 gap-[0.4em]">{d.machines.map((m) => (
              <li key={m.name} className="flex items-center justify-between rounded bg-white/5 px-[0.8em] py-[0.35em]">
                <span>{m.name}</span><Pill c={color(MS[m.status]?.[1] ?? "stopped")}>{MS[m.status]?.[0] ?? m.status}</Pill>
              </li>))}</ul>
          </Panel>}
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen items-center justify-center bg-board-bg p-10 text-center text-2xl text-white/80">{children}</div>;
}
function Panel({ title, count, children, grow, tone }: { title: string; count: number; children: React.ReactNode; grow?: boolean; tone?: string }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg border border-board-line bg-board-panel ${grow ? "flex-1" : ""}`}>
      <h2 className="flex shrink-0 justify-between border-b border-board-line px-[0.9em] py-[0.45em] text-[1.15em] font-bold"><span>{title}</span><span style={{ color: tone }} className="tabular-nums">{count}</span></h2>
      <div className="min-h-0 flex-1 overflow-x-auto p-[0.7em] lg:overflow-hidden">{children}</div>
    </section>
  );
}
function Table({ rows, cols, render, empty, color }: { rows: BoardRow[]; cols: string[]; render: (r: BoardRow) => React.ReactNode[]; empty: string; color: (h: Health) => string }) {
  if (!rows.length) return <p className="text-white/50">{empty}</p>;
  return (
    <table className="w-full border-separate border-spacing-y-[0.25em]">
      <thead><tr>{cols.map((c) => <th key={c} className="px-[0.5em] text-start text-[0.85em] font-medium text-white/50">{c}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.ref} className="bg-white/[0.04]">{render(r).map((cell, i) => <td key={i} className={`px-[0.5em] py-[0.35em] ${i === 0 ? "font-semibold tabular-nums" : ""}`} style={i === 0 ? { borderInlineStart: `5px solid ${color(r.health)}` } : undefined}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}
const Ref = ({ r }: { r: BoardRow }) => <span className="whitespace-nowrap"><span className="block">{r.orderNo}</span><span className="block text-[0.75em] font-normal text-white/45">{r.prNo}</span></span>;
const Pill = ({ c, children }: { c: string; children: React.ReactNode }) => <span className="whitespace-nowrap rounded px-[0.6em] py-[0.1em] text-[0.9em] font-semibold text-black" style={{ background: c }}>{children}</span>;
const Bar = ({ v, c }: { v: number; c: string }) => (
  <span className="flex items-center gap-2"><span className="h-[0.55em] w-[5em] overflow-hidden rounded bg-white/10"><span className="block h-full" style={{ width: `${v}%`, background: c }} /></span><span className="tabular-nums">{v}%</span></span>
);
/** تمرير تلقائي بطيء للجداول الطويلة ثم العودة للأعلى */
function AutoScroll({ on, children }: { on: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    const el = ref.current; if (!el) return;
    let pause = 0;
    const t = setInterval(() => {
      if (el.scrollHeight <= el.clientHeight) return;
      if (pause > 0) { pause--; return; }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) { pause = 60; setTimeout(() => el.scrollTo({ top: 0 }), 3000); return; }
      el.scrollTop += 1;
    }, 50);
    return () => clearInterval(t);
  }, [on]);
  return <div ref={ref} className="lg:h-full lg:overflow-hidden">{children}</div>;
}

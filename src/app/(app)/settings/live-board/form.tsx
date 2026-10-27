"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Field } from "@/components/ui";
import { Notice, ActionButton } from "@/components/client";
import { saveBoardConfigAction, newBoardDeviceAction, revokeBoardDeviceAction } from "@/server/actions";
import type { BoardConfig } from "@/server/services/liveboard";
import type { ActionResult } from "@/lib/errors";

type Device = { id: string; name: string; isActive: boolean; lastSeen: string | null; config: BoardConfig };
const SECTIONS: [keyof BoardConfig["sections"], string][] = [["kpis", "مؤشرات الإنتاج"], ["active", "الطلبات قيد التنفيذ"], ["late", "الطلبات المتأخرة"], ["next", "الطلبات التالية"], ["machines", "حالة الآلات"]];
const COLORS: [keyof BoardConfig["colors"], string][] = [["onTrack", "حسب الجدول"], ["atRisk", "معرض للتأخير"], ["late", "متأخر"], ["scheduled", "مجدول"], ["stopped", "متوقف/معلق"]];

export function BoardSettings({ devices, machines }: { devices: Device[]; machines: { id: string; name: string }[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4">
      {devices.filter((d) => d.isActive).map((d) => <DeviceCard key={d.id} d={d} machines={machines} />)}
      <Card title="إضافة شاشة جديدة">
        <div className="flex gap-2"><input className="input max-w-xs" placeholder="اسم الشاشة (مثل: صالة القص)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" disabled={pending} onClick={() => start(async () => { const r = await newBoardDeviceAction(name); if (r.ok) { setToken(r.data!.token); router.refresh(); } })}>إنشاء رابط</button></div>
        {token && <div className="mt-3 rounded bg-amber-50 p-3 text-sm">انسخ الرابط الآن — لن يظهر مرة أخرى:<div className="mt-1 select-all break-all font-mono text-xs" dir="ltr">{`${location.origin}/live-board?device=${token}`}</div>
          <p className="mt-2 text-xs">للتشغيل كـ Kiosk على جهاز التلفاز: <span dir="ltr" className="font-mono">chrome --kiosk --noerrdialogs --disable-session-crashed-bubble "الرابط"</span> أو Microsoft Edge بنفس الخيار <span dir="ltr">--kiosk</span>.</p></div>}
      </Card>
      {devices.some((d) => !d.isActive) && <p className="text-xs text-ink-faint">شاشات موقوفة: {devices.filter((d) => !d.isActive).map((d) => d.name).join("، ")}</p>}
    </div>
  );
}

function DeviceCard({ d, machines }: { d: Device; machines: { id: string; name: string }[] }) {
  const [c, setC] = useState<BoardConfig>(d.config);
  const [r, setR] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card title={`${d.name} — آخر اتصال ${d.lastSeen ?? "لم يتصل بعد"}`}
      actions={<ActionButton className="text-sm text-magenta-process" confirm="إيقاف هذه الشاشة؟ سيتوقف رابطها فورًا." action={() => revokeBoardDeviceAction(d.id)}>إيقاف الرابط</ActionButton>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div><span className="label">الأقسام المعروضة</span>{SECTIONS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.sections[k]} onChange={(e) => setC({ ...c, sections: { ...c.sections, [k]: e.target.checked } })} /> {l}</label>)}</div>
        <div><span className="label">الآلات المعروضة (بدون تحديد = الكل)</span>{machines.map((m) => <label key={m.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.machineIds?.includes(m.id)} onChange={(e) => { const ids = new Set(c.machineIds ?? []); e.target.checked ? ids.add(m.id) : ids.delete(m.id); setC({ ...c, machineIds: ids.size ? [...ids] : null }); }} /> {m.name}</label>)}</div>
        <div className="space-y-2">
          <Field label="عدد الطلبات في كل قائمة"><input type="number" min={3} max={30} className="input" value={c.maxRows} onChange={(e) => setC({ ...c, maxRows: Number(e.target.value) })} /></Field>
          <Field label="فترة فحص التحديث (ثوانٍ)"><input type="number" min={3} max={120} className="input" value={c.refreshSeconds} onChange={(e) => setC({ ...c, refreshSeconds: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.autoScroll} onChange={(e) => setC({ ...c, autoScroll: e.target.checked })} /> تمرير تلقائي للجداول الطويلة</label>
        </div>
      </div>
      <div className="mt-4"><span className="label">ألوان الحالات</span><div className="flex flex-wrap gap-4">{COLORS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="color" value={c.colors[k]} onChange={(e) => setC({ ...c, colors: { ...c.colors, [k]: e.target.value } })} /> {l}</label>)}</div></div>
      <div className="mt-4 flex items-center gap-3"><button className="btn-primary" disabled={pending} onClick={() => start(async () => setR(await saveBoardConfigAction(d.id, c)))}>حفظ — تُطبَّق على الشاشة خلال ثوانٍ بعد إعادة الاتصال</button><a className="btn-ghost" href="/live-board" target="_blank">معاينة</a></div>
      <div className="mt-2"><Notice r={r} /></div>
    </Card>
  );
}

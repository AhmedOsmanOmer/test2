"use client";
import { useState, useTransition } from "react";
import { Card, Field } from "@/components/ui";
import { Notice } from "@/components/client";
import { saveGeneralSettingsAction } from "@/server/actions";
import type { GeneralSettings } from "@/server/services/settings";
import type { ActionResult } from "@/lib/errors";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function GeneralForm({ initial }: { initial: GeneralSettings }) {
  const [s, setS] = useState(initial);
  const [r, setR] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof GeneralSettings>(k: K, v: GeneralSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-4">
      <Card title="بيانات الشركة (تظهر في سندات التسليم)">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="الاسم بالعربية"><input className="input" value={s["company.nameAr"]} onChange={(e) => set("company.nameAr", e.target.value)} /></Field>
          <Field label="الاسم بالإنجليزية"><input className="input" dir="ltr" value={s["company.nameEn"]} onChange={(e) => set("company.nameEn", e.target.value)} /></Field>
          <Field label="الهاتف"><input className="input" dir="ltr" value={s["company.phone"]} onChange={(e) => set("company.phone", e.target.value)} /></Field>
          <Field label="الرقم الضريبي"><input className="input" dir="ltr" value={s["company.vatNumber"]} onChange={(e) => set("company.vatNumber", e.target.value)} /></Field>
          <Field label="السجل التجاري"><input className="input" dir="ltr" value={s["company.crNumber"]} onChange={(e) => set("company.crNumber", e.target.value)} /></Field>
          <Field label="العنوان"><input className="input" value={s["company.address"]} onChange={(e) => set("company.address", e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="ساعات العمل">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="بداية الدوام"><input type="time" className="input" value={s["work.hours"].start} onChange={(e) => set("work.hours", { ...s["work.hours"], start: e.target.value })} /></Field>
          <Field label="نهاية الدوام"><input type="time" className="input" value={s["work.hours"].end} onChange={(e) => set("work.hours", { ...s["work.hours"], end: e.target.value })} /></Field>
          <div><span className="label">أيام الإجازة الأسبوعية</span><div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s["work.weekend"].includes(i)} onChange={(e) => set("work.weekend", e.target.checked ? [...s["work.weekend"], i] : s["work.weekend"].filter((x) => x !== i))} />{d}</label>)}</div></div>
        </div>
      </Card>
      <div className="flex items-center gap-3"><button className="btn-primary" disabled={pending} onClick={() => start(async () => setR(await saveGeneralSettingsAction(s)))}>حفظ الإعدادات</button><Notice r={r} /></div>
    </div>
  );
}

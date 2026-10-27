"use client";
import { uuid } from "@/lib/uuid";
import { useState } from "react";
import { FormAction } from "@/components/client";
import { Field } from "@/components/ui";
import { logProgressAction } from "@/server/actions";

export function ProgressForm({ id, remaining }: { id: string; remaining: number }) {
  const [key, setKey] = useState(uuid);
  return (
    <FormAction className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" action={async (f) => {
      const r = await logProgressAction(id, Number(f.get("good") || 0), Number(f.get("scrap") || 0), String(f.get("reason") || "") || undefined, String(f.get("note") || "") || undefined, key);
      if (r.ok) setKey(uuid()); return r;
    }}>
      <Field label={`منجز سليم (متبقٍ ${remaining})`}><input name="good" type="number" min={0} max={remaining} className="input" /></Field>
      <Field label="تالف"><input name="scrap" type="number" min={0} className="input" /></Field>
      <Field label="سبب التالف"><input name="reason" className="input" list="scrap-reasons" /><datalist id="scrap-reasons"><option value="انحراف لون" /><option value="خطأ قص" /><option value="تمزق" /><option value="عيب خامة" /><option value="خطأ تركيب" /></datalist></Field>
      <Field label="ملاحظة"><input name="note" className="input" /></Field>
      <div className="flex items-end"><button className="btn-primary w-full">تسجيل</button></div>
    </FormAction>
  );
}

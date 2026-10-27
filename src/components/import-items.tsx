"use client";
import { TableScroll } from "@/components/ui";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmImportAction, cancelImportAction } from "@/server/actions";
import type { RowError } from "@/lib/order-item-import";
import type { ItemData } from "@/lib/order-item";

type Preview = {
  importId: string | null; fileName: string; totalRows: number; validRows: { row: number; data: ItemData }[]; errors: RowError[];
  warnings: { row: number; message: string }[]; duplicateFile: boolean; canConfirm: boolean; fileError?: string;
};

/**
 * استيراد بنود من Excel. مع orderId: معاينة ثم تأكيد في الطلب القائم.
 * بدونه (نموذج «طلب جديد»): تُعاد البنود المتحقق منها لتعبئة النموذج عبر onRows.
 */
export function ImportItems({ orderId, onRows }: { orderId?: string; onRows?: (rows: ItemData[]) => void }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const upload = async () => {
    const f = input.current?.files?.[0];
    setErr(null); setOk(null); setP(null); setAgain(false);
    if (!f) return setErr("اختر ملف Excel");
    const fd = new FormData(); fd.append("file", f); if (orderId) fd.append("orderId", orderId);
    setBusy(true);
    try {
      const r = await fetch("/api/orders/items-import", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({ error: "تعذّرت قراءة رد الخادم" }));
      if (!r.ok) return setErr(d.error ?? "تعذّرت معالجة الملف");
      if (d.fileError) return setErr(d.fileError);
      if (!orderId && d.canConfirm && onRows) {
        onRows((d as Preview).validRows.map((x) => x.data));
        setOk(`تمت تعبئة ${d.validRows.length} بندًا من الملف — راجعها ثم احفظ الطلب`);
        if (input.current) input.current.value = "";
        return;
      }
      setP(d);
    } catch { setErr("تعذّر رفع الملف. تحقق من الاتصال وأعد المحاولة."); } finally { setBusy(false); }
  };
  const confirm = () => start(async () => {
    if (!p?.importId) return;
    const r = await confirmImportAction(p.importId, again);
    if (r.ok) { setOk(`تم استيراد ${r.data?.count ?? 0} بندًا`); setP(null); if (input.current) input.current.value = ""; router.refresh(); }
    else setErr(r.error);
  });
  const cancel = () => {
    // التفريغ فورًا قبل انتظار الخادم، حتى لا يُمسح ملف يختاره المستخدم بعد الإلغاء مباشرة
    const id = p?.importId; setP(null); setErr(null); if (input.current) input.current.value = "";
    if (id) start(async () => { await cancelImportAction(id); });
  };

  return (
    <div className="space-y-3" data-testid="import-items">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">ملف Excel (.xlsx، حتى 5 ميجابايت و500 صف)</span>
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="input" name="importFile" /></label>
        <button type="button" className="btn-primary" disabled={busy || pending} onClick={upload}>{busy ? "جارٍ الفحص…" : orderId ? "رفع ومعاينة" : "تعبئة البنود من الملف"}</button>
        <a href="/api/orders/items-template" className="btn-ghost">تنزيل القالب</a>
      </div>
      <p className="text-xs text-ink-faint">بلا أسعار أو مبالغ: أي عمود مالي يرفض الملف. الاستيراد يضيف بنودًا ولا يستبدل الموجودة، وأي خطأ في أي صف يمنع الاستيراد كله.</p>
      {err && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</p>}
      {ok && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{ok}</p>}
      {p && (
        <div className="space-y-3 rounded-md border border-paper-line p-3" data-testid="import-preview">
          <div className="flex flex-wrap gap-4 text-sm">
            <span>الملف: <b dir="auto">{p.fileName}</b></span><span>الصفوف: <b>{p.totalRows}</b></span>
            <span className="text-emerald-700">صالحة: <b>{p.validRows.length}</b></span><span className="text-rose-700">أخطاء: <b>{p.errors.length}</b></span>
          </div>
          {p.errors.length > 0 && <>
            <p className="text-sm font-semibold text-rose-800">صحّح هذه الأخطاء في الملف ثم ارفعه من جديد (لن يُستورد أي بند قبل ذلك):</p>
            <TableScroll><table className="w-full text-sm" data-testid="import-errors"><thead><tr className="border-b border-paper-line"><th className="th">الصف</th><th className="th">العمود</th><th className="th">القيمة</th><th className="th">المشكلة</th></tr></thead>
              <tbody>{p.errors.map((e, i) => <tr key={i} className="border-b border-paper-line/60"><td className="td tabular-nums">{e.row || "—"}</td><td className="td">{e.column || "—"}</td><td className="td" dir="auto">{e.value || "—"}</td><td className="td text-rose-800">{e.message}</td></tr>)}</tbody></table></TableScroll>
          </>}
          {p.warnings.length > 0 && <ul className="space-y-1 text-sm text-amber-800">{p.warnings.map((w, i) => <li key={i}>تنبيه — الصف {w.row}: {w.message}</li>)}</ul>}
          {p.validRows.length > 0 && <TableScroll><table className="w-full text-sm" data-testid="import-rows"><thead><tr className="border-b border-paper-line"><th className="th">الصف</th><th className="th">المنتج</th><th className="th">الكمية</th><th className="th">الوحدة</th><th className="th">الخامة</th><th className="th">الطباعة</th><th className="th">المقاس</th></tr></thead>
            <tbody>{p.validRows.map((r) => <tr key={r.row} className="border-b border-paper-line/60"><td className="td tabular-nums">{r.row}</td><td className="td">{r.data.name}</td><td className="td tabular-nums">{r.data.quantity}</td><td className="td">{r.data.unit}</td><td className="td">{r.data.material ?? "—"}</td><td className="td">{r.data.printType ?? "—"}</td><td className="td">{[r.data.length, r.data.width, r.data.height].filter(Boolean).join(" × ") || "—"}</td></tr>)}</tbody></table></TableScroll>}
          {p.duplicateFile && <label className="flex items-center gap-2 text-sm text-amber-800"><input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} /> هذا الملف نفسه استُورد سابقًا لهذا الطلب — أؤكد استيراده مرة أخرى</label>}
          <div className="flex gap-2">
            {p.canConfirm && <button type="button" className="btn-primary" disabled={pending || (p.duplicateFile && !again)} onClick={confirm}>{pending ? "جارٍ الاستيراد…" : `تأكيد استيراد ${p.validRows.length} بند`}</button>}
            <button type="button" className="btn-ghost" disabled={pending} onClick={cancel}>إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}

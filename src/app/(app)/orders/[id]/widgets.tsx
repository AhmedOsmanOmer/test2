"use client";
import { uuid } from "@/lib/uuid";
import { resizeToJpeg } from "@/lib/image-resize";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, TableScroll } from "@/components/ui";
import { FormAction, Notice } from "@/components/client";
import type { ActionResult } from "@/lib/errors";
import { changeStatusAction, changeDueDateAction, reassignSalesRepAction, setOrderMoneyAction, setDepositReceivedAction, assignDesignAction, createProductionAction, addCommentAction, uploadOrderFilesAction } from "@/server/actions";
import { ORDER_STATUS, DELIVERY_METHOD } from "@/lib/labels";
import type { OrderStatus } from "@/generated/prisma/enums";


export function StatusControl({ orderId, version, current }: { orderId: string; version: number; current: OrderStatus }) {
  const [to, setTo] = useState<OrderStatus | "">("");
  const [reason, setReason] = useState("");
  const [r, setR] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value as OrderStatus)}>
          <option value="">نقل إلى…</option>
          {Object.entries(ORDER_STATUS).filter(([k]) => k !== current).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <input className="input" placeholder="السبب (مطلوب للإرجاع والإيقاف والإلغاء)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-primary w-full" disabled={!to || pending} onClick={() => {
        if (to === "CANCELLED" && !window.confirm("تأكيد إلغاء الطلب؟ لا يمكن التراجع.")) return;
        start(async () => { const res = await changeStatusAction(orderId, to as OrderStatus, reason || undefined, version); setR(res); if (res.ok) { setTo(""); setReason(""); router.refresh(); } });
      }}>{pending ? "جارٍ التحديث…" : "تحديث الحالة"}</button>
      <Notice r={r} />
    </div>
  );
}

/** تغيير موعد التسليم (orders.edit) — السبب إلزامي */
export function DueDateForm({ orderId, version, current, minDate }: { orderId: string; version: number; current: string; minDate: string }) {
  return (
    <FormAction resetOnSuccess={false} className="space-y-2" action={(f) => changeDueDateAction(orderId, String(f.get("dueDate") ?? ""), String(f.get("reason") ?? ""), version)}>
      <Field label="موعد التسليم الجديد"><input name="dueDate" type="date" className="input" defaultValue={current} min={minDate} required /></Field>
      <Field label="السبب"><input name="reason" className="input" required maxLength={500} /></Field>
      <button className="btn-primary w-full">تغيير الموعد</button>
    </FormAction>
  );
}

/** تغيير موظف المبيعات المسؤول (orders.reassign) — السبب إلزامي */
export function ReassignRepForm({ orderId, version, currentRepId, reps }: { orderId: string; version: number; currentRepId: string; reps: { id: string; fullName: string }[] }) {
  return (
    <FormAction className="space-y-2" action={(f) => reassignSalesRepAction(orderId, String(f.get("rep") ?? ""), String(f.get("reason") ?? ""), version)}>
      <Field label="موظف المبيعات الجديد"><select name="rep" className="input" required defaultValue="">
        <option value="" disabled>اختر</option>{reps.filter((r) => r.id !== currentRepId).map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
      </select></Field>
      <Field label="السبب"><input name="reason" className="input" required maxLength={500} /></Field>
      <button className="btn-primary w-full">نقل الطلب</button>
    </FormAction>
  );
}

/** قيمة الطلب والمبلغ المدفوع — تظهر فقط لمن يملك orders.edit_value */
export function MoneyForm({ orderId, version, total, paidAmount }: { orderId: string; version: number; total: number; paidAmount: number }) {
  const [r, setR] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      start(async () => {
        const res = await setOrderMoneyAction(orderId, { total: Number(f.get("total")), paidAmount: Number(f.get("paidAmount")), expectedVersion: version });
        setR(res); if (res.ok) router.refresh();
      });
    }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-2">
        <Field label="قيمة الطلب (ر.س)"><input name="total" type="number" step="0.01" min="0" defaultValue={total} className="input" required /></Field>
        <Field label="المبلغ المدفوع (ر.س)"><input name="paidAmount" type="number" step="0.01" min="0" defaultValue={paidAmount} className="input" required /></Field>
      </div>
      <button className="btn-primary w-full" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ المبالغ"}</button>
      <Notice r={r} />
    </form>
  );
}

/** «تم استلام الدفعة المقدمة» — لمن يملك orders.set_deposit */
export function DepositToggle({ orderId, received }: { orderId: string; received: boolean }) {
  const [checked, setChecked] = useState(received);
  const [r, setR] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} disabled={pending} onChange={(e) => {
          const value = e.target.checked;
          let reason: string | undefined;
          if (!value) { const v = window.prompt("سبب إلغاء تأكيد الدفعة المقدمة:"); if (v === null) return; reason = v; }
          setChecked(value);
          start(async () => {
            const res = await setDepositReceivedAction(orderId, value, reason); setR(res);
            if (res.ok) router.refresh(); else setChecked(!value);
          });
        }} />
        تم استلام الدفعة المقدمة
      </label>
      <Notice r={r} />
    </div>
  );
}

export function AssignDesign({ orderId, items, designers }: { orderId: string; items: { id: string; name: string }[]; designers: { id: string; fullName: string }[] }) {
  return (
    <FormAction action={(f) => assignDesignAction(orderId, String(f.get("item")) || undefined, String(f.get("assignee")), String(f.get("due") || "") || undefined, String(f.get("instructions") || "") || undefined)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Field label="المنتج"><select name="item" className="input"><option value="">كل المنتجات</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
      <Field label="المصمم"><select name="assignee" className="input" required>{designers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}</select></Field>
      <Field label="موعد التسليم"><input name="due" type="date" className="input" /></Field>
      <div className="flex items-end"><button className="btn-primary w-full">إسناد التصميم</button></div>
      <Field label="تعليمات التصميم" className="sm:col-span-full lg:col-span-4"><textarea name="instructions" rows={2} className="input" /></Field>
    </FormAction>
  );
}

export function CreateProduction({ orderId, items, machines, workers, stagesByItem }: {
  orderId: string; items: { id: string; name: string; remaining: number }[]; machines: { id: string; name: string; status: string }[];
  workers: { id: string; fullName: string }[]; stagesByItem: Record<string, string[]>;
}) {
  const ALL = ["تجهيز الملفات", "تجهيز الخامات", "الطباعة", "القص", "التشكيل", "التجميع", "التشطيب", "التغليف", "الفحص النهائي"];
  const [item, setItem] = useState(items[0]?.id ?? "");
  const [stages, setStages] = useState<string[]>(stagesByItem[items[0]?.id] ?? ALL);
  const [r, setR] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!items.length) return <p className="text-sm text-ink-soft">تمت جدولة كامل كميات المنتجات.</p>;
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      start(async () => {
        const res = await createProductionAction({
          orderId, orderItemId: item, quantity: Number(f.get("quantity")), machineId: String(f.get("machine") || "") || undefined,
          assigneeId: String(f.get("worker") || "") || undefined, plannedStart: f.get("start") ? new Date(String(f.get("start"))) : undefined,
          plannedEnd: f.get("end") ? new Date(String(f.get("end"))) : undefined, stages,
        });
        setR(res); if (res.ok) router.refresh();
      });
    }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Field label="المنتج" className="sm:col-span-2 lg:col-span-2"><select className="input" value={item} onChange={(e) => { setItem(e.target.value); setStages(stagesByItem[e.target.value] ?? ALL); }}>{items.map((i) => <option key={i.id} value={i.id}>{i.name} (متبقٍ {i.remaining})</option>)}</select></Field>
        <Field label="الكمية (دفعة)"><input name="quantity" type="number" min={1} max={items.find((i) => i.id === item)?.remaining} defaultValue={items.find((i) => i.id === item)?.remaining} className="input" required /></Field>
        <Field label="الآلة"><select name="machine" className="input"><option value="">—</option>{machines.map((m) => <option key={m.id} value={m.id} disabled={m.status === "MAINTENANCE"}>{m.name}</option>)}</select></Field>
        <Field label="الموظف المسؤول" className="sm:col-span-2 lg:col-span-2"><select name="worker" className="input"><option value="">—</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.fullName}</option>)}</select></Field>
        <Field label="بداية مخططة" className="sm:col-span-2 lg:col-span-2"><input name="start" type="datetime-local" className="input" /></Field>
        <Field label="نهاية مخططة" className="sm:col-span-2 lg:col-span-2"><input name="end" type="datetime-local" className="input" /></Field>
      </div>
      <div>
        <span className="label">مراحل التشغيل (اختر ما يحتاجه المنتج بالترتيب)</span>
        <div className="flex flex-wrap gap-2">{ALL.map((s) => (
          <label key={s} className={`cursor-pointer rounded border px-2.5 py-1 text-sm ${stages.includes(s) ? "border-cyan-process bg-sky-50" : "border-paper-line"}`}>
            <input type="checkbox" className="sr-only" checked={stages.includes(s)} onChange={(e) => setStages((xs) => e.target.checked ? ALL.filter((x) => xs.includes(x) || x === s) : xs.filter((x) => x !== s))} />
            {stages.includes(s) ? `${stages.indexOf(s) + 1}. ` : ""}{s}
          </label>))}</div>
      </div>
      <button className="btn-primary" disabled={pending || !stages.length}>{pending ? "جارٍ الإنشاء…" : "إنشاء أمر التشغيل"}</button>
      <Notice r={r} />
    </form>
  );
}

type Proof = { id: string; blob: Blob; url: string };

/**
 * تسليم (جزئي أو كامل) مع صور إثبات إلزامية (1-5): الكاميرا مباشرة على الجوال، ومنتقي ملفات على سطح المكتب.
 * الصور تُصغَّر في المتصفح ثم تُرسل مع بيانات التسليم في طلب واحد؛ والخادم يتحقق منها ويرفض الكل إن كان أي ملف غير صالح.
 */
export function DeliveryForm({ orderId, items, address }: { orderId: string; items: { id: string; name: string; ready: number }[]; address?: string }) {
  const [k, setK] = useState(() => uuid());
  const [photos, setPhotos] = useState<Proof[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; number: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const router = useRouter();
  const MAX = 5;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    const room = MAX - photos.length;
    if (room <= 0) return setErr(`الحد الأقصى ${MAX} صور`);
    const added: Proof[] = [];
    for (const f of [...files].slice(0, room)) {
      try {
        const blob = await resizeToJpeg(f);
        if (blob.size > 8 * 1024 * 1024) { setErr("الصورة أكبر من 8 ميجابايت حتى بعد التصغير"); continue; }
        added.push({ id: uuid(), blob, url: URL.createObjectURL(blob) });
      } catch (e) { setErr((e as Error).message); }
    }
    if (files.length > room) setErr(`الحد الأقصى ${MAX} صور — أُضيف ${added.length} فقط`);
    setPhotos((p) => [...p, ...added]);
  };
  const remove = (id: string) => setPhotos((p) => { const x = p.find((y) => y.id === id); if (x) URL.revokeObjectURL(x.url); return p.filter((y) => y.id !== id); });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!photos.length) return setErr("التقط صورة إثبات واحدة على الأقل");
    const f = new FormData(e.currentTarget);
    const payload = {
      method: f.get("method"), address: String(f.get("address") || "") || undefined, recipientName: String(f.get("recipient") ?? ""),
      recipientPhone: String(f.get("phone") || "") || undefined, notes: String(f.get("notes") || "") || undefined,
      items: items.map((i) => ({ orderItemId: i.id, quantity: Number(f.get(`q_${i.id}`) || 0) })), idempotencyKey: k,
    };
    const body = new FormData();
    body.append("payload", JSON.stringify(payload));
    photos.forEach((p, i) => body.append("photos", p.blob, `photo-${i + 1}.jpg`));
    setBusy(true); setErr(null); setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/orders/${orderId}/deliveries`);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.onload = () => {
      setBusy(false); setProgress(null);
      let d: { id?: string; number?: string; error?: string } = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* رد غير متوقع */ }
      if (xhr.status === 200 && d.id) {
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        setPhotos([]); setK(uuid()); setDone({ id: d.id, number: d.number ?? "" });
        // بعد التسليم النهائي يختفي النموذج؛ فنعرض التأكيد على مستوى الصفحة
        router.replace(`/orders/${orderId}?tab=delivery&dn=${d.id}`, { scroll: true }); router.refresh();
      } else setErr(d.error ?? "تعذّر حفظ التسليم. حاول مرة أخرى.");
    };
    xhr.onerror = () => { setBusy(false); setProgress(null); setErr("انقطع الاتصال أثناء الرفع. تحقق من الشبكة وأعد المحاولة (لن يتكرر التسليم)."); };
    xhr.send(body);
  };

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="delivery-form">
      <TableScroll><table className="w-full"><thead><tr className="border-b border-paper-line"><th className="th">المنتج</th><th className="th">الجاهز للتسليم</th><th className="th">الكمية المسلّمة الآن</th></tr></thead>
        <tbody>{items.map((i) => <tr key={i.id}><td className="td">{i.name}</td><td className="td tabular-nums">{i.ready}</td><td className="td"><input name={`q_${i.id}`} type="number" inputMode="numeric" min={0} max={i.ready} defaultValue={i.ready} className="input w-32" aria-label={`الكمية المسلّمة من ${i.name}`} /></td></tr>)}</tbody></table></TableScroll>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="طريقة التسليم"><select name="method" className="input">{Object.entries(DELIVERY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="اسم المستلم *"><input name="recipient" className="input" required /></Field>
        <Field label="جوال المستلم"><input name="phone" className="input" dir="ltr" inputMode="tel" /></Field>
        <Field label="عنوان التسليم"><input name="address" className="input" defaultValue={address} /></Field>
        <Field label="ملاحظات" className="sm:col-span-full lg:col-span-4"><input name="notes" className="input" /></Field>
      </div>

      <fieldset className="rounded-md border border-paper-line p-3">
        <legend className="px-1 text-sm font-semibold">صور إثبات التسليم (إلزامية، حتى {MAX})</legend>
        <label className={`btn-primary min-h-[48px] w-full cursor-pointer text-base sm:w-auto ${photos.length >= MAX || busy ? "pointer-events-none opacity-50" : ""}`}>
          <span aria-hidden>📷</span> التقاط صورة التسليم
          {/* على الجوال يفتح الكاميرا مباشرة؛ على سطح المكتب منتقي ملفات */}
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" name="proof" data-testid="proof-input"
            disabled={photos.length >= MAX || busy} onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        </label>
        {photos.length > 0 && <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="proof-thumbs">
          {photos.map((p, i) => (
            <li key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`صورة الإثبات ${i + 1}`} className="aspect-square w-full rounded-md border border-paper-line object-cover" />
              <button type="button" onClick={() => remove(p.id)} disabled={busy} aria-label={`حذف الصورة ${i + 1}`}
                className="absolute end-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-xl text-white">×</button>
            </li>))}
        </ul>}
        <p className="mt-2 text-xs text-ink-soft">{photos.length ? `${photos.length} صورة جاهزة` : "لا يمكن تأكيد التسليم بدون صورة واحدة على الأقل"}</p>
      </fieldset>

      {progress !== null && <div className="h-2 w-full overflow-hidden rounded bg-paper-line" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم الرفع"><div className="h-full bg-cyan-process transition-all" style={{ width: `${progress}%` }} /></div>}
      <button className="btn-primary w-full sm:w-auto" disabled={busy || photos.length === 0} data-testid="confirm-delivery">{busy ? `جارٍ الرفع… ${progress ?? 0}%` : "تسليم وإصدار سند"}</button>
      {err && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</p>}
      {done && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">تم التسليم بسند {done.number} — <a className="font-semibold underline" target="_blank" rel="noopener" href={`/print/delivery/${done.id}`}>طباعة السند</a></p>}
    </form>
  );
}

export function CommentBox({ orderId }: { orderId: string }) {
  return <FormAction action={(f) => addCommentAction(orderId, String(f.get("body")))} className="flex gap-2"><input name="body" className="input" placeholder="اكتب تعليقًا داخليًا…" required /><button className="btn-primary">إرسال</button></FormAction>;
}

export function FileUpload({ orderId }: { orderId: string }) {
  return (
    <FormAction action={(f) => uploadOrderFilesAction(orderId, f)} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <Field label="نوع الملف"><select name="kind" className="input sm:w-48">
        <option value="REFERENCE">ملف مرجعي</option><option value="PRODUCT_PHOTO">صورة منتج</option><option value="WORK_ORDER">أمر تشغيل</option><option value="QC_REPORT">تقرير جودة</option><option value="OTHER">أخرى</option>
      </select></Field>
      <Field label="الملفات (AI, PSD, PDF, SVG, JPG, PNG, TIFF, EPS)"><input type="file" name="files" multiple className="input" /></Field>
      <button className="btn-primary">رفع</button>
    </FormAction>
  );
}

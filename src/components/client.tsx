"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/errors";

export function Notice({ r }: { r: ActionResult<unknown> | null }) {
  if (!r) return null;
  return r.ok
    ? (r.message ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{r.message}</p> : null)
    : <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{r.error}</p>;
}

/** زر ينفذ إجراء خادم مع تأكيد اختياري وسبب اختياري */
export function ActionButton({ action, children, confirm, askReason, className = "btn-ghost", onDone }: {
  action: (reason?: string) => Promise<ActionResult<unknown>>; children: ReactNode; confirm?: string; askReason?: string; className?: string; onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult<unknown> | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={className} disabled={pending} onClick={() => {
        let reason: string | undefined;
        if (askReason) { const v = window.prompt(askReason); if (v === null) return; reason = v; }
        else if (confirm && !window.confirm(confirm)) return;
        start(async () => { const res = await action(reason); setR(res); if (res.ok) { router.refresh(); onDone?.(); } });
      }}>{pending ? "جارٍ التنفيذ…" : children}</button>
      {r && !r.ok && <Notice r={r} />}
    </span>
  );
}

/** نموذج يرسل FormData لإجراء خادم ويعرض النتيجة */
export function FormAction({ action, children, className, resetOnSuccess = true }: {
  action: (f: FormData) => Promise<ActionResult<unknown>>; children: ReactNode; className?: string; resetOnSuccess?: boolean;
}) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult<unknown> | null>(null);
  const router = useRouter();
  return (
    <form className={className} onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget; const fd = new FormData(form);
      start(async () => { const res = await action(fd); setR(res); if (res.ok) { if (resetOnSuccess) form.reset(); router.refresh(); } });
    }}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      <div className="mt-2"><Notice r={r} /></div>
    </form>
  );
}

/** لوحة التصفية: على الجوال تُطوى خلف زر «تصفية»، ومن 640px تظهر دائمًا */
export function FilterPanel({ children, active = 0 }: { children: ReactNode; active?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button type="button" className="btn-ghost w-full sm:hidden" aria-expanded={open} aria-controls="filter-panel" onClick={() => setOpen((o) => !o)}>
        تصفية{active > 0 ? ` (${active})` : ""} <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      <div id="filter-panel" className={open ? "mt-2 block" : "hidden sm:block"}>{children}</div>
    </div>
  );
}

/** يُظهر التبويب النشط داخل شريط تبويبات قابل للتمرير الأفقي (الجوال) */
export function ScrollActiveIntoView({ container }: { container: string }) {
  useEffect(() => {
    const nav = document.querySelector(container);
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && active) active.scrollIntoView({ block: "nearest", inline: "center" });
  });
  return null;
}

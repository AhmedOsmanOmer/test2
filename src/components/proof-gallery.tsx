"use client";
import { useCallback, useEffect, useState } from "react";

export type ProofPhoto = { id: string; alt: string; caption: string };

/** شبكة مصغرات صور إثبات التسليم مع عارض بملء الشاشة (لمس، Escape، السابق/التالي) */
export function ProofGallery({ photos }: { photos: ProofPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // في RTL: السهم الأيسر = التالي
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, photos.length, close]);
  const cur = open === null ? null : photos[open];
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="proof-gallery">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(i)} className="block w-full overflow-hidden rounded-md border border-paper-line" aria-label={`عرض ${p.alt}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${p.id}`} alt={p.alt} loading="lazy" className="aspect-square w-full object-cover" />
            </button>
          </li>))}
      </ul>
      {cur && (
        <div role="dialog" aria-modal="true" aria-label={cur.alt} data-testid="proof-viewer" className="fixed inset-0 z-50 flex flex-col bg-black/90 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={close}>
          <div className="flex items-center justify-between gap-2 p-2 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 wrap-anywhere">{cur.caption} — {open! + 1}/{photos.length}</span>
            <span className="flex shrink-0 gap-1">
              <a href={`/api/files/${cur.id}`} target="_blank" rel="noopener" className="inline-flex h-11 items-center rounded px-3 hover:bg-white/10">الحجم الكامل</a>
              <button type="button" onClick={close} className="inline-flex h-11 w-11 items-center justify-center rounded text-2xl hover:bg-white/10" aria-label="إغلاق" autoFocus>×</button>
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${cur.id}`} alt={cur.alt} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
          {photos.length > 1 && <div className="flex justify-between p-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="h-11 rounded px-4 text-white hover:bg-white/10 disabled:opacity-30" disabled={open === 0} onClick={() => setOpen(open! - 1)}>السابقة</button>
            <button type="button" className="h-11 rounded px-4 text-white hover:bg-white/10 disabled:opacity-30" disabled={open === photos.length - 1} onClick={() => setOpen(open! + 1)}>التالية</button>
          </div>}
        </div>
      )}
    </>
  );
}

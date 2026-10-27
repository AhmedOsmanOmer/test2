import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export const cx = clsx;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight wrap-anywhere sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-soft wrap-anywhere">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card min-w-0", className)}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-line px-3 py-3 sm:px-4">
          <h2 className="min-w-0 text-sm font-semibold wrap-anywhere">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700", cyan: "bg-sky-100 text-sky-800", green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800", red: "bg-rose-100 text-rose-800", violet: "bg-violet-100 text-violet-800", ink: "bg-ink text-white",
} as const;
export type Tone = keyof typeof TONES;
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium", TONES[tone])}>{children}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-soft">{hint}</p>}
      {action}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: "red" | "cyan" | "green" | "yellow" }) {
  const bar = { red: "bg-magenta-process", cyan: "bg-cyan-process", green: "bg-emerald-500", yellow: "bg-yellow-process" }[tone ?? "cyan"];
  const body = (
    <div className="card relative overflow-hidden p-4 transition hover:border-cyan-process">
      <span className={cx("absolute inset-y-0 start-0 w-1", bar)} />
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums wrap-anywhere sm:text-2xl">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded bg-paper-line"><div className="h-full bg-cyan-process" style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="text-xs tabular-nums text-ink-soft">{value}%</span>
    </div>
  );
}

export function Pager({ page, total, perPage = 25, base }: { page: number; total: number; perPage?: number; base: string }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const sep = base.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3 text-sm text-ink-soft">
      <span>{total} سجل — صفحة {page} من {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-ghost" href={`${base}${sep}page=${page - 1}`}>السابق</Link>}
        {page < pages && <Link className="btn-ghost" href={`${base}${sep}page=${page + 1}`}>التالي</Link>}
      </div>
    </div>
  );
}

/**
 * نمط الجداول الموحد للجوال:
 * - TableScroll: حاوية تمرير أفقي داخلية مع عمود أول ثابت (للجداول التقنية العريضة) — الصفحة نفسها لا تتمرر أفقيًا.
 * - ResponsiveTable: بطاقات مكدسة على الجوال (أهم 3-4 حقول + الحالة + رابط)، والجدول نفسه من 640px.
 *   الحقول المالية تُمرَّر كما هي من الصفحة بنفس فحوص الصلاحية، فلا تظهر لمن لا يملكها.
 */
export function TableScroll({ children, sticky = true, minWidth = 640, className }: { children: ReactNode; sticky?: boolean; minWidth?: number; className?: string }) {
  return <div className={cx("table-scroll", sticky && "table-sticky", className)} style={{ ["--table-min" as string]: `${minWidth}px` }}>{children}</div>;
}

export type MobileCard = { key: string; href?: string; title: ReactNode; badge?: ReactNode; lines?: ReactNode[]; actions?: ReactNode };
export function CardList({ items, className, empty }: { items: MobileCard[]; className?: string; empty?: ReactNode }) {
  if (!items.length) return <>{empty ?? null}</>;
  return (
    <ul className={cx("space-y-2", className)}>
      {items.map((c) => (
        <li key={c.key} className="rounded-md border border-paper-line p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 font-medium wrap-anywhere">{c.href ? <Link href={c.href} className="text-cyan-deep">{c.title}</Link> : c.title}</div>
            {c.badge && <div className="flex shrink-0 flex-wrap justify-end gap-1">{c.badge}</div>}
          </div>
          {!!c.lines?.length && <div className="mt-1 space-y-0.5 text-sm text-ink-soft wrap-anywhere">{c.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
          {c.actions && <div className="mt-2 flex flex-wrap gap-2">{c.actions}</div>}
        </li>
      ))}
    </ul>
  );
}

export function ResponsiveTable({ cards, children, minWidth, empty }: { cards: MobileCard[]; children: ReactNode; minWidth?: number; empty?: ReactNode }) {
  return (
    <>
      <CardList items={cards} className="sm:hidden" empty={<div className="sm:hidden">{empty}</div>} />
      <div className="hidden sm:block"><TableScroll minWidth={minWidth}>{children}</TableScroll></div>
    </>
  );
}

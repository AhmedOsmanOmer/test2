"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeStatusAction } from "@/server/actions";
import { ORDER_STATUS, PRIORITY } from "@/lib/labels";
import type { OrderStatus, Priority } from "@/generated/prisma/enums";

type Card = { id: string; number: string; status: OrderStatus; customer: string; priority: Priority; due: string; dueLabel: string; late: boolean; version: number };
export function Kanban({ columns, orders }: { columns: { key: string; title: string; statuses: OrderStatus[] }[]; orders: Card[] }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const colIndex = (s: OrderStatus) => columns.findIndex((c) => c.statuses.includes(s));
  const drop = (card: Card, colIdx: number) => {
    const target = columns[colIdx].statuses[0];
    if (columns[colIdx].statuses.includes(card.status)) return;
    let reason: string | undefined;
    if (colIdx < colIndex(card.status) || target === "ON_HOLD") { const r = window.prompt("اذكر السبب (مطلوب لإرجاع الطلب أو تعليقه):"); if (!r) return; reason = r; }
    start(async () => {
      const r = await changeStatusAction(card.id, target, reason, card.version);
      setErr(r.ok ? null : `${card.number}: ${r.error}`);
      router.refresh();
    });
  };
  return (
    <div>
      {err && <p role="alert" className="mb-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</p>}
      <div className={`flex gap-3 overflow-x-auto pb-2 ${pending ? "opacity-60" : ""}`}>
        {columns.map((col, i) => {
          const cards = orders.filter((o) => col.statuses.includes(o.status));
          return (
            <div key={col.key} className="w-[min(15rem,80vw)] shrink-0 rounded-lg bg-paper p-2" onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const c = orders.find((o) => o.id === e.dataTransfer.getData("id")); if (c) drop(c, i); }}>
              <div className="mb-2 flex justify-between px-1 text-sm font-semibold"><span>{col.title}</span><span className="text-ink-soft">{cards.length}</span></div>
              <div className="space-y-2">{cards.map((c) => (
                <div key={c.id} draggable onDragStart={(e) => e.dataTransfer.setData("id", c.id)}
                  className={`card cursor-grab p-2.5 text-sm ${c.late ? "border-s-4 border-s-magenta-process" : ""}`}>
                  <Link href={`/orders/${c.id}`} className="font-semibold text-cyan-deep">{c.number}</Link>
                  <div className="truncate text-ink-soft">{c.customer}</div>
                  <div className="mt-1 flex justify-between text-xs"><span>{ORDER_STATUS[c.status]}</span><span className={c.priority === "URGENT" ? "text-magenta-process" : ""}>{PRIORITY[c.priority]}</span></div>
                  <div className={`text-xs ${c.late ? "text-magenta-process" : "text-ink-faint"}`}>التسليم {c.dueLabel}</div>
                </div>))}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-faint">اسحب البطاقة إلى عمود آخر لنقلها. يرفض النظام أي انتقال يخالف قواعد العمل (الدفعة، اعتماد التصميم، الجودة…) ويوضح السبب. على شاشات اللمس (الجوال واللوحي) لا يعمل السحب: افتح الطلب وغيّر حالته من «تغيير الحالة».</p>
    </div>
  );
}

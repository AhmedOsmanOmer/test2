"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRouter } from "next/navigation";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const fmt = (v: number) => new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(v);

/** أشرطة HTML بدل Recharts لأن محاور Recharts لا تعرض التسميات العربية بشكل سليم في RTL */
export function StatusChart({ data }: { data: { status: string; label: string; count: number }[] }) {
  const router = useRouter();
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="space-y-1.5">
      {[...data].sort((a, b) => b.count - a.count).map((d) => (
        <li key={d.status}>
          <button type="button" onClick={() => router.push(`/orders?status=${d.status}`)} className="group flex w-full items-center gap-3 text-sm">
            <span className="w-40 shrink-0 text-start group-hover:text-cyan-deep">{d.label}</span>
            <span className="h-5 flex-1 rounded bg-paper"><span className="block h-full rounded" style={{ width: `${(d.count / max) * 100}%`, background: d.status === "CANCELLED" ? "#D6246E" : ["DELIVERED", "CLOSED"].includes(d.status) ? "#16A34A" : "#0093C9" }} /></span>
            <span className="w-8 text-end tabular-nums">{fmt(d.count)}</span>
          </button>
        </li>))}
    </ul>
  );
}

export function MonthlyChart({ data }: { data: { month: number; orders: number }[] }) {
  const rows = data.map((d) => ({ ...d, name: MONTHS[d.month - 1] }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={rows} margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#DDE3EA" />
        <XAxis dataKey="name" reversed tick={{ fontSize: 11 }} />
        <YAxis orientation="right" tickFormatter={fmt} width={50} allowDecimals={false} />
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Legend />
        <Line dataKey="orders" name="عدد الطلبات" stroke="#0093C9" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PeopleChart({ data }: { data: { name: string; designs: number; production: number; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#DDE3EA" />
        <XAxis dataKey="name" reversed tick={{ fontSize: 10 }} interval={0} />
        <YAxis orientation="right" allowDecimals={false} />
        <Tooltip /><Legend />
        <Bar dataKey="sales" name="طلبات مبيعات" fill="#14213D" />
        <Bar dataKey="designs" name="تصاميم معتمدة" fill="#D6246E" />
        <Bar dataKey="production" name="أوامر تشغيل منجزة" fill="#0093C9" />
      </BarChart>
    </ResponsiveContainer>
  );
}

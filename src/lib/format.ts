const sar = new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", minimumFractionDigits: 2 });
const num = new Intl.NumberFormat("ar-SA");
export const money = (v: unknown) => sar.format(Number(v ?? 0));
export const n = (v: unknown) => num.format(Number(v ?? 0));
export const date = (d?: Date | string | null) =>
  d ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(d)) : "—";
export const dateTime = (d?: Date | string | null) =>
  d ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d)) : "—";
export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
/** تاريخ اليوم (أو أي لحظة) بتوقيت الرياض بصيغة YYYY-MM-DD — للمقارنة بالتاريخ دون الوقت */
export const riyadhYmd = (d: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

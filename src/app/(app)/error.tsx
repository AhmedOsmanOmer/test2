"use client";
import { Card } from "@/components/ui";

export default function AppError({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <Card className="mx-auto mt-16 max-w-lg text-center">
      <h1 className="text-xl font-bold">تعذر عرض هذه الصفحة</h1>
      <p className="mt-2 text-sm text-ink-soft">حدث خطأ في الخادم. أعد المحاولة، وإن تكرر أبلغ مدير النظام برمز الخطأ.</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-ink-faint" dir="ltr">{error.digest}</p>}
      <button className="btn-primary mt-4" onClick={reset}>إعادة المحاولة</button>
    </Card>
  );
}

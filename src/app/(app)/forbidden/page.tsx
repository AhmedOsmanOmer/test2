import Link from "next/link";
import { Card } from "@/components/ui";

export default function Forbidden() {
  return (
    <Card className="mx-auto mt-16 max-w-lg text-center">
      <h1 className="text-xl font-bold">ليست لديك صلاحية لهذه الصفحة</h1>
      <p className="mt-2 text-sm text-ink-soft">إذا كنت تحتاجها في عملك، اطلب من مدير النظام إضافة الصلاحية لحسابك.</p>
      <Link href="/my" className="btn-primary mt-4">الذهاب إلى مهامي</Link>
    </Card>
  );
}

import Link from "next/link";
import { Card } from "@/components/ui";
export default function NotFound() {
  return <Card className="mx-auto mt-16 max-w-lg text-center"><h1 className="text-xl font-bold">العنصر غير موجود</h1><p className="mt-2 text-sm text-ink-soft">ربما حُذف الرابط أو ليست لديك صلاحية الوصول إليه.</p><Link href="/" className="btn-primary mt-4">الصفحة الرئيسية</Link></Card>;
}

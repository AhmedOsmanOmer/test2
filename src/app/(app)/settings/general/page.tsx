import { requireActor, pagePerm } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { getGeneral } from "@/server/services/settings";
import { GeneralForm } from "./form";

export default async function GeneralSettingsPage() {
  const a = await requireActor(); pagePerm(a, "settings.manage");
  const s = await getGeneral();
  return (
    <>
      <PageHeader title="الإعدادات العامة" subtitle="بيانات الشركة التي تظهر في سندات التسليم، وساعات العمل" />
      <GeneralForm initial={s} />
    </>
  );
}

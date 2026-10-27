import { requireActor, pagePerm } from "@/server/auth";
import { PageHeader, Card } from "@/components/ui";
import { CustomerForm } from "./form";

export default async function NewCustomer() {
  pagePerm(await requireActor(), "customers.manage");
  return <><PageHeader title="عميل جديد" /><Card className="max-w-4xl"><CustomerForm /></Card></>;
}

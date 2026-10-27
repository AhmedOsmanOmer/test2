import { Badge, type Tone } from "./ui";
import { ORDER_STATUS, PRIORITY, PRODUCTION_STATUS, DESIGN_STATUS, MACHINE_STATUS, ITEM_STATUS } from "@/lib/labels";
import type { OrderStatus, Priority, ProductionStatus, DesignStatus, MachineStatus, ItemStatus } from "@/generated/prisma/enums";

const orderTone = (s: OrderStatus): Tone =>
  ["CANCELLED", "RETURNED"].includes(s) ? "red" : ["ON_HOLD", "NEEDS_REVISION", "REWORK"].includes(s) ? "yellow"
  : ["DELIVERED", "CLOSED"].includes(s) ? "green" : ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"].includes(s) ? "violet"
  : ["IN_PRODUCTION", "FINISHING_PACKAGING", "PRODUCTION_SCHEDULED", "MATERIALS_PREP", "QUALITY_CHECK"].includes(s) ? "cyan" : "gray";

export const OrderBadge = ({ s }: { s: OrderStatus }) => <Badge tone={orderTone(s)}>{ORDER_STATUS[s]}</Badge>;
export const PriorityBadge = ({ p }: { p: Priority }) => <Badge tone={p === "URGENT" ? "red" : p === "HIGH" ? "yellow" : "gray"}>{PRIORITY[p]}</Badge>;
export const ItemBadge = ({ s }: { s: ItemStatus }) => <Badge tone={s === "CANCELLED" ? "red" : s === "DELIVERED" ? "green" : s === "REWORK" ? "yellow" : "gray"}>{ITEM_STATUS[s]}</Badge>;
export const ProdBadge = ({ s }: { s: ProductionStatus }) => <Badge tone={s === "IN_PROGRESS" ? "cyan" : s === "QC_PASSED" ? "green" : s === "QC_FAILED" ? "red" : s === "PAUSED" ? "yellow" : "gray"}>{PRODUCTION_STATUS[s]}</Badge>;
export const DesignBadge = ({ s }: { s: DesignStatus }) => <Badge tone={s === "APPROVED" ? "green" : s === "CHANGES_REQUESTED" ? "red" : s === "SENT_TO_CUSTOMER" ? "violet" : s === "PENDING" ? "gray" : "cyan"}>{DESIGN_STATUS[s]}</Badge>;
export const MachineBadge = ({ s }: { s: MachineStatus }) => <Badge tone={s === "RUNNING" ? "green" : s === "AVAILABLE" ? "cyan" : s === "MAINTENANCE" ? "yellow" : "gray"}>{MACHINE_STATUS[s]}</Badge>;
export const LateBadge = () => <Badge tone="red">متأخر</Badge>;

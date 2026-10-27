/** كتالوج الصلاحيات — المصدر الوحيد للحقيقة. يُزرع في قاعدة البيانات عبر seed. */
export const PERMISSIONS = {
  "dashboard.view": ["لوحة التحكم", "لوحة"],
  "dashboard.financial": ["المؤشرات المالية في اللوحة", "لوحة"],
  "customers.view": ["عرض العملاء", "العملاء"],
  "customers.manage": ["إضافة/تعديل العملاء", "العملاء"],
  "customers.contact": ["رؤية أرقام وبيانات تواصل العملاء", "العملاء"],
  "orders.view": ["عرض الطلبات", "الطلبات"],
  "orders.view_all": ["عرض كل الطلبات (وليس طلباتي فقط)", "الطلبات"],
  "orders.view_value": ["رؤية قيمة الطلب والمتبقي", "الطلبات"],
  "orders.edit_value": ["إدخال قيمة الطلب والمبلغ المدفوع", "الطلبات"],
  "orders.set_deposit": ["تأكيد استلام الدفعة المقدمة", "الطلبات"],
  "orders.reassign": ["تغيير موظف المبيعات المسؤول عن الطلب", "الطلبات"],
  "orders.import_items": ["استيراد بنود الطلب من Excel", "الطلبات"],
  "orders.create": ["إنشاء الطلبات", "الطلبات"],
  "orders.edit": ["تعديل الطلبات", "الطلبات"],
  "orders.change_status": ["تغيير حالة الطلب", "الطلبات"],
  "orders.cancel": ["إلغاء الطلبات", "الطلبات"],
  "orders.close": ["إغلاق الطلبات", "الطلبات"],
  "design.view": ["عرض مهام التصميم", "التصميم"],
  "design.work": ["العمل على التصميم ورفع النسخ", "التصميم"],
  "design.assign": ["إسناد التصميم", "التصميم"],
  "design.approve": ["الاعتماد الداخلي وتسجيل اعتماد العميل", "التصميم"],
  "production.view": ["عرض الإنتاج", "الإنتاج"],
  "production.manage": ["إنشاء وجدولة أوامر التشغيل", "الإنتاج"],
  "production.work": ["تحديث أوامر التشغيل المسندة", "الإنتاج"],
  "machines.manage": ["إدارة الآلات", "الإنتاج"],
  "liveboard.manage": ["إدارة شاشة الإنتاج المباشر", "الإنتاج"],
  "quality.inspect": ["فحص الجودة", "الجودة"],
  "delivery.view": ["عرض التسليم", "التسليم"],
  "delivery.manage": ["تنفيذ التسليم", "التسليم"],
  "tasks.manage": ["إنشاء وإسناد المهام", "المهام"],
  "reports.view": ["التقارير التشغيلية", "التقارير"],
  "files.view": ["عرض الملفات", "الملفات"],
  "files.upload": ["رفع الملفات", "الملفات"],
  "users.manage": ["إدارة المستخدمين والصلاحيات", "الإعدادات"],
  "settings.manage": ["إعدادات النظام", "الإعدادات"],
  "audit.view": ["سجل التدقيق", "الإعدادات"],
} as const satisfies Record<string, readonly [string, string]>;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

/** صلاحيات المال: لا يملكها إلا المدير العام ومشرف المبيعات والمبيعات (بحدود) */
export const MONEY_PERMISSIONS: PermissionKey[] = ["orders.view_value", "orders.edit_value", "orders.set_deposit", "dashboard.financial"];

const SALES: PermissionKey[] = [
  "dashboard.view", "customers.view", "customers.manage", "customers.contact", "orders.view", "orders.create", "orders.edit",
  "orders.change_status", "orders.view_value", "orders.edit_value", "orders.import_items", "design.view", "production.view", "delivery.view",
  "files.view", "files.upload",
];

export const ROLES: Record<string, { name: string; permissions: PermissionKey[] }> = {
  SUPER_ADMIN: { name: "المدير العام", permissions: ALL },
  OPERATIONS_MANAGER: {
    name: "مدير العمليات",
    permissions: [
      "dashboard.view", "customers.view", "customers.manage", "customers.contact",
      "orders.view", "orders.view_all", "orders.create", "orders.edit", "orders.change_status", "orders.cancel", "orders.close",
      "design.view", "design.work", "design.assign", "design.approve",
      "production.view", "production.manage", "production.work", "machines.manage", "liveboard.manage",
      "quality.inspect", "delivery.view", "delivery.manage", "tasks.manage", "reports.view", "files.view", "files.upload",
    ],
  },
  SALES_SUPERVISOR: {
    name: "مشرف المبيعات",
    permissions: [...SALES, "orders.view_all", "orders.set_deposit", "orders.reassign", "orders.close"],
  },
  SALES: { name: "موظف المبيعات", permissions: SALES },
  DESIGNER: { name: "المصمم", permissions: ["orders.view", "orders.view_all", "design.view", "design.work", "files.view", "files.upload"] },
  PRODUCTION_SUPERVISOR: {
    name: "مشرف الإنتاج",
    permissions: ["dashboard.view", "orders.view", "orders.view_all", "orders.change_status", "design.view", "production.view", "production.manage",
      "production.work", "machines.manage", "liveboard.manage", "tasks.manage", "files.view", "files.upload", "reports.view"],
  },
  PRODUCTION_WORKER: { name: "موظف الإنتاج", permissions: ["orders.view", "orders.view_all", "production.view", "production.work", "files.view"] },
  QUALITY: { name: "مسؤول الجودة", permissions: ["orders.view", "orders.view_all", "production.view", "quality.inspect", "files.view", "files.upload"] },
  DELIVERY: {
    name: "مسؤول التسليم",
    permissions: ["orders.view", "orders.view_all", "customers.contact", "delivery.view", "delivery.manage", "files.view", "files.upload"],
  },
};

/** الأدوار التي يجوز أن تكون «موظف المبيعات المسؤول» عن طلب */
export const SALES_REP_ROLES = ["SALES", "SALES_SUPERVISOR", "OPERATIONS_MANAGER", "SUPER_ADMIN"];

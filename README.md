# Printing gate ERP — نظام إدارة شركة بوابة الطباعة للدعاية والإعلان

نظام ويب داخلي لأجهزة الكمبيوتر يربط المبيعات والتصميم والإنتاج والجودة والتسليم، مع **شاشة إنتاج مباشر** للتلفاز داخل المطبعة. المال مبسّط: قيمة واحدة لكل طلب والمبلغ المدفوع وتأكيد الدفعة المقدمة، ويراها المدير العام ومشرف المبيعات وموظف المبيعات لطلباته فقط.

> الحالة الحالية: **نسخة تشغيلية أولى (MVP) مختبرة**. راجع [`docs/STATUS.md`](docs/STATUS.md) لمعرفة ما تم تنفيذه واختباره وما بقي قبل الاعتماد عليه في التشغيل الفعلي.

## أسهل طريقة للتجربة على Mac (بدون تثبيت أي شيء)
1. فك ضغط الملف وانقل مجلد `gp-erp` إلى Documents.
2. أول مرة فقط: انقر **بالزر الأيمن** على `تشغيل-النظام.command` ← **فتح (Open)** ← **فتح** مرة أخرى في رسالة التحذير.
3. انتظر (أول مرة 3–8 دقائق حسب سرعة الإنترنت). سيفتح المتصفح تلقائيًا. المستخدم `admin`، وكلمة مرور أولية عشوائية تُطبع في النافذة **مرة واحدة فقط** عند أول تشغيل (احفظها؛ وهي محفوظة أيضًا في `.env` باسم `SEED_ADMIN_PASSWORD`). يُطلب تغييرها عند أول دخول.
4. المرات التالية: نقرة مزدوجة على الملف، والنظام جاهز خلال ثوانٍ. للإيقاف: Control + C أو أغلق النافذة.

يحمّل الملف Node.js وقاعدة بيانات مدمجة **داخل مجلد المشروع فقط** (`.runtime`) ولا يغيّر شيئًا في جهازك. لحذف كل شيء: احذف المجلد. هذه الطريقة للتجربة على جهاز واحد فقط، وليست للنشر على خادم الشركة.

## التقنيات
Next.js 14 (App Router) + React 18 + TypeScript، Tailwind CSS، PostgreSQL 16، Prisma 7 (بدون محركات خارجية)، Recharts، بث مباشر بـ Server-Sent Events. الخط العربي (IBM Plex Sans Arabic) مدمج محليًا فيعمل النظام على شبكة داخلية بلا إنترنت.

## متطلبات الخادم
- Linux (Ubuntu 22.04/24.04 مقترح)، 2 vCPU و4 GB RAM كحد أدنى لمطبعة متوسطة، ومساحة تكفي لملفات التصميم (ابدأ بـ 100 GB).
- Node.js 20 أو 22، PostgreSQL 16، Nginx، شهادة HTTPS.
- خادم Node دائم التشغيل (داخل المطبعة أو VPS). **لا يناسب الاستضافات المؤقتة Serverless** لأن البث المباشر للشاشة يحتاج اتصالًا مستمرًا.

## التثبيت للتطوير
```bash
cp .env.example .env            # عدّل القيم: SESSION_SECRET و CRON_SECRET و SEED_ADMIN_PASSWORD و POSTGRES_PASSWORD
docker compose up -d db         # أو PostgreSQL مثبت محليًا (المنفذ مربوط على 127.0.0.1 فقط)
npm install
npx prisma migrate deploy            # ينشئ الجداول من prisma/migrations
SEED_DEMO=true npm run db:seed       # الأدوار والصلاحيات والمستخدمون التجريبيون
npx tsx scripts/demo-data.ts         # (اختياري) ~30 طلبًا تجريبيًا تحمل "(تجريبي)" — آمن للتكرار
npm run dev                          # http://localhost:3000  — المستخدم admin (وضع التطوير يسمح بـ unsafe-eval فقط فيه؛ الإنتاج بسياسة CSP صارمة)
```
بيانات الاختبار: كل المستخدمين التجريبيين كلمة مرورهم هي `SEED_ADMIN_PASSWORD` ويُطلب تغييرها عند أول دخول:

| المستخدم | الدور |
|---|---|
| admin | المدير العام (يرى المال والمؤشرات المالية وسجل التدقيق) |
| salessup | مشرف المبيعات (كل الطلبات وقيمها، تأكيد الدفعة المقدمة، الإغلاق) |
| sales, sales2, sales3 | موظف المبيعات (طلباته فقط، وقيمتها) |
| ops | مدير العمليات (كل الطلبات بلا مبالغ) |
| designer, designer2 | المصمم |
| supervisor | مشرف الإنتاج |
| worker, worker2 | موظف الإنتاج |
| qc | مسؤول الجودة |
| delivery | مسؤول التسليم |

## النشر على خادم الإنتاج
```bash
sudo useradd -r -m -d /opt/gp-erp gperp
# انسخ المشروع إلى /opt/gp-erp ثم:
cd /opt/gp-erp
cp .env.example .env && chmod 600 .env     # أسرار قوية: openssl rand -hex 32
npm ci
npx prisma migrate deploy                  # بعد توليد مجلد prisma/migrations في بيئة التطوير وإيداعه
npm run db:seed                            # إنتاج: الأدوار والصلاحيات وحساب admin فقط (بدون SEED_DEMO)
npm run build
sudo cp deploy/gp-erp.service deploy/gp-erp-*.service deploy/gp-erp-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gp-erp gp-erp-checks.timer gp-erp-backup.timer
sudo cp deploy/nginx.conf /etc/nginx/sites-available/gp-erp   # عدّل اسم النطاق والشهادة
sudo ln -s /etc/nginx/sites-available/gp-erp /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```
ثم: سجّل الدخول بـ `admin` وغيّر كلمة المرور فورًا ← الإعدادات العامة (اسم الشركة وبياناتها) ← أضف الآلات ← أضف الموظفين ← أنشئ رابط شاشة الإنتاج.

## شاشة الإنتاج المباشر على التلفاز
1. الإعدادات ← شاشة الإنتاج المباشر ← «إنشاء رابط» (يظهر مرة واحدة فقط، احفظه).
2. على الجهاز المتصل بالتلفاز (Mini PC أو Chromebox أو Android TV مع Chrome):
   `chrome --kiosk --noerrdialogs --disable-session-crashed-bubble "https://erp.example.sa/live-board?device=..."`
3. الرابط يعرض البيانات التشغيلية فقط (لا أسعار ولا مبالغ ولا هواتف عملاء)، ويمكن إيقافه فورًا من الإعدادات.
4. عطّل وضع السكون في الجهاز والتلفاز. الشاشة تعيد الاتصال تلقائيًا عند انقطاع الشبكة.

## النسخ الاحتياطي والاستعادة
- تلقائيًا يوميًا 02:30 عبر `gp-erp-backup.timer`: قاعدة البيانات + مجلد الملفات مع بصمات SHA-256، والاحتفاظ 30 يومًا.
- **ضروري:** حدد `BACKUP_REMOTE` (جهاز NAS أو خادم آخر) لتكون هناك نسخة خارج الخادم.
- الاستعادة: `systemctl stop gp-erp && scripts/restore.sh /var/backups/gp-erp/<التاريخ> && systemctl start gp-erp`
- **اختبر الاستعادة شهريًا** على خادم اختبار؛ النسخة التي لم تُجرَّب استعادتها لا يُعتمد عليها.

## الاختبارات
```bash
npm test                    # اختبارات الوحدة (الصلاحيات، آلة الحالات، نطاق الطلبات، رسائل التحقق)
TEST_DATABASE_URL="postgresql://…@127.0.0.1:5434/…" npm test   # + اختبارات التكامل على قاعدة اختبار (المنفذ 5434 فقط، بعد seed تجريبي)
npm run test:scenario       # السيناريو التشغيلي الكامل على قاعدة اختبار (DATABASE_URL لقاعدة اختبار)
npm run checks              # تشغيل فحوصات قرب الموعد والتأخر (الإشعارات) يدويًا
scripts/test-all.sh         # يعيد تهيئة قاعدة اختبار + السيناريو + مسار إعادة الإنتاج
python3 scripts/e2e.py      # اختبار عبر المتصفح (يتطلب Playwright لبايثون؛ يقرأ SEED_ADMIN_PASSWORD و CRON_SECRET من البيئة أو .env)
```
⚠️ `test-all.sh` و`scripts/sql-bootstrap.ts` **يمسحان قاعدة البيانات**. لا تشغّلهما أبدًا على قاعدة الإنتاج. أداة `sql-bootstrap` بديل اختباري فقط لـ `prisma migrate` في بيئة لم يتوفر فيها محرك الترحيل.

## هيكل المشروع
```
prisma/schema.prisma      مخطط قاعدة البيانات (38 جدولًا)
prisma/migrations/        ملفات الترحيل (أولها init)
prisma/seed.ts            الأدوار والصلاحيات والإعدادات (+ مستخدمون تجريبيون مع SEED_DEMO)
scripts/demo-data.ts      ~30 طلبًا تجريبيًا عبر طبقة الخدمات
src/lib/                  منطق نقي: آلة حالات الطلب، الصلاحيات، نطاق الطلبات ورؤية المال، التنسيق
src/server/services/      منطق العمل وقواعده (كل التحقق من الصلاحيات هنا)
src/server/actions.ts     إجراءات الخادم التي تستدعيها الواجهة
src/app/(app)/            صفحات النظام
src/app/live-board/       شاشة التلفاز
src/app/api/              live-board (بيانات + بث)، files (تنزيل محمي)، cron
deploy/                   systemd و nginx
docs/                     المعمارية، دليل الاستخدام، حالة المشروع
```

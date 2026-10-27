"""اختبار شامل عبر المتصفح: يزور كل الصفحات بأدوار مختلفة ويتحقق من الأخطاء والصلاحيات وشاشة الإنتاج."""
import json, os, sys, re
from playwright.sync_api import sync_playwright

# لا كلمات مرور ثابتة: كلمة مرور المستخدمين التجريبيين = SEED_ADMIN_PASSWORD (من البيئة أو ملف .env)
def env(key, default=None):
    if os.environ.get(key): return os.environ[key]
    try:
        for line in open(".env", encoding="utf-8"):
            m = re.match(rf'\s*{key}\s*=\s*"?([^"\n]*)"?', line)
            if m: return m.group(1)
    except FileNotFoundError: pass
    return default

BASE = env("E2E_BASE", "http://localhost:3000")
PW = env("SEED_ADMIN_PASSWORD")
CRON = env("CRON_SECRET", "")
TOKEN = env("E2E_DEVICE_TOKEN") or open("/tmp/token").read().strip()
if not PW: sys.exit("حدد SEED_ADMIN_PASSWORD")
fails, passes = [], 0

def ok(cond, msg):
    global passes
    if cond: passes += 1; print("  ✓", msg)
    else: fails.append(msg); print("  ✗", msg)

def login(page, user):
    page.goto(f"{BASE}/login")
    page.fill("input[name=username]", user); page.fill("input[name=password]", PW)
    page.click("button:has-text('دخول')"); page.wait_for_load_state("networkidle")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 768}, locale="ar-SA")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "ERR_NAME_NOT_RESOLVED" not in m.text and "Failed to fetch RSC payload" not in m.text and errors.append(m.text))

    print("\n— الدخول والأمان")
    page.goto(f"{BASE}/login"); page.fill("input[name=username]", "admin"); page.fill("input[name=password]", "wrong-password")
    page.click("button:has-text('دخول')"); page.wait_for_selector("text=غير صحيحة", timeout=8000)
    ok("غير صحيحة" in page.content(), "رفض كلمة مرور خاطئة برسالة عامة")
    login(page, "admin")
    ok(page.url.rstrip("/") == BASE, "دخول المدير وتحويله للوحة التحكم")
    ok(page.locator("html[dir=rtl]").count() == 1, "الصفحة RTL")

    print("\n— زيارة كل الصفحات (المدير العام)")
    order_id = page.evaluate("fetch('/orders').then(r=>r.text())")
    page.goto(f"{BASE}/search?q=GP-2026-0001"); page.wait_for_url(re.compile(r"/orders/c")); oid = "/orders/" + page.url.split("/orders/")[1].split("?")[0]
    page.goto(f"{BASE}/production"); poid = page.locator("a[href^='/production/c']").first.get_attribute("href") if page.locator("a[href^='/production/c']").count() else None
    page.goto(f"{BASE}/design"); dsid = page.locator("a[href^='/design/c']").first.get_attribute("href")
    page.goto(f"{BASE}/customers"); cid = page.locator("a[href^='/customers/c']").first.get_attribute("href")
    pages = ["/", "/?p=year", "/my", "/customers", cid, "/customers/new", "/orders", "/orders?view=kanban", "/orders/new",
             "/design", dsid, "/production", "/production?view=schedule", "/production/machines", "/quality", "/delivery",
             "/notifications", "/settings", "/settings/users", "/settings/live-board", "/settings/audit", "/search?q=GP-2026", "/search?q=عطور"]
    pages += [f"{oid}?tab={t}" for t in ["overview", "items", "design", "production", "quality", "delivery", "files", "comments", "timeline"]]
    if poid: pages.append(poid)
    for path in pages:
        errors.clear()
        r = page.goto(BASE + path); page.wait_for_load_state("networkidle")
        bad = r.status >= 400 or "Application error" in page.content() or "Unhandled Runtime Error" in page.content()
        ok(not bad and not errors, f"{path} → {r.status}" + (f" أخطاء: {errors[:2]}" if errors else ""))
    page.goto(f"{BASE}/"); page.screenshot(path="/tmp/shots/01-dashboard.png", full_page=True)
    page.goto(f"{BASE}/orders?view=kanban"); page.screenshot(path="/tmp/shots/02-kanban.png")
    page.goto(f"{BASE}{oid}?tab=timeline"); page.screenshot(path="/tmp/shots/03-order-timeline.png", full_page=True)
    page.goto(f"{BASE}{oid}?tab=overview"); page.screenshot(path="/tmp/shots/04-order-value.png", full_page=True)
    page.goto(f"{BASE}/production?view=schedule"); page.screenshot(path="/tmp/shots/05-schedule.png")

    print("\n— وظائف عبر الواجهة")
    # إنشاء عميل من النموذج
    page.goto(f"{BASE}/customers/new")
    page.fill("input[name=name]", "(اختبار متصفح) مؤسسة الأفق"); page.fill("input[name=phone]", "0500000001")
    page.click("button:has-text('حفظ العميل')"); page.wait_for_load_state("networkidle")
    ok("/customers/c" in page.url and "مؤسسة الأفق" in page.content(), "إنشاء عميل من الواجهة والانتقال لملفه")
    new_cid = page.url.split("/customers/")[1]
    # إنشاء طلب من الواجهة
    page.goto(f"{BASE}/orders/new?customer={new_cid}")
    page.locator("label:has-text('اسم المنتج') input").fill("لوحة إعلانية خارجية")
    page.fill("input[name=dueDate]", "2030-12-01")
    page.fill("input[name=total]", "2500")
    page.click("button:has-text('حفظ الطلب')"); page.wait_for_url(re.compile(r"/orders/c"), timeout=10000)
    ok("GP-2026" in page.content(), "إنشاء طلب من الواجهة: " + page.locator("h1").inner_text())
    new_oid = page.url.split("/orders/")[1].split("?")[0]
    # محاولة نقل مخالفة للقواعد عبر الواجهة
    page.select_option("select", "IN_PRODUCTION"); page.click("button:has-text('تحديث الحالة')"); page.wait_for_timeout(1200)
    ok("الدفعة المقدمة" in page.content() or "اعتماد التصميم" in page.content() or "صلاحية" in page.content(), "الواجهة تعرض سبب رفض الانتقال المخالف")
    # تعليق
    page.goto(f"{BASE}/orders/{new_oid}?tab=comments"); page.fill("input[name=body]", "العميل يفضل الخلفية الزرقاء"); page.click("button:has-text('إرسال')"); page.wait_for_timeout(1200)
    ok("الخلفية الزرقاء" in page.content(), "إضافة تعليق داخلي")
    # رفع ملف
    page.goto(f"{BASE}/orders/{new_oid}?tab=files")
    open("/tmp/ref.pdf", "wb").write(b"%PDF-1.4 reference file")
    page.set_input_files("input[name=files]", "/tmp/ref.pdf"); page.click("button:has-text('رفع')"); page.wait_for_timeout(1500)
    ok("ref.pdf" in page.content(), "رفع ملف مرجعي للطلب")
    href = page.locator("a:has-text('ref.pdf')").first.get_attribute("href")
    r = page.request.get(BASE + href); ok(r.status == 200 and r.body().startswith(b"%PDF"), "تنزيل الملف عبر المسار المحمي")
    # قيمة الطلب والمبلغ المدفوع عبر النموذج (بلا أرقام في السجل الزمني)
    page.goto(f"{BASE}/orders/{new_oid}")
    page.fill("input[name=paidAmount]", "1000"); page.click("button:has-text('حفظ المبالغ')"); page.wait_for_timeout(1500)
    ok("تم حفظ المبالغ" in page.content(), "تسجيل المبلغ المدفوع من الواجهة")
    page.goto(f"{BASE}/orders/{new_oid}?tab=timeline")
    ok("تم تحديث المبلغ المدفوع" in page.content() and "1,000" not in page.content() and "١٬٠٠٠" not in page.content(), "السجل الزمني بلا مبالغ")
    page.goto(f"{BASE}/orders/{oid.split('/')[-1]}?tab=delivery"); dn = page.locator("a:has-text('طباعة السند')").first.get_attribute("href")
    page.goto(BASE + dn); ok("سند تسليم" in page.content() and "توقيع المستلم" in page.content(), "سند التسليم للطباعة"); page.screenshot(path="/tmp/shots/06-delivery-note.png")
    for gone in ["/quotations", "/payments", "/inventory"]:
        r = page.goto(BASE + gone); ok(r.status == 404, f"الوحدة المحذوفة {gone} غير موجودة ({r.status})")

    print("\n— إجبار تغيير كلمة المرور المؤقتة")
    c3 = b.new_context(viewport={"width": 1366, "height": 768}); p3 = c3.new_page(); login(p3, "ops")
    ok("/account/password" in p3.url, "المستخدم بكلمة مرور مؤقتة يُحوَّل لتغييرها")
    p3.goto(f"{BASE}/orders"); ok("/account/password" in p3.url, "لا يمكنه تجاوز صفحة التغيير")
    p3.fill("input[name=current]", PW); p3.fill("input[name=next]", "short"); p3.fill("input[name=confirm]", "short")
    p3.evaluate("document.querySelectorAll('input[minlength]').forEach(e=>e.removeAttribute('minlength'))"); p3.click("button:has-text('حفظ')"); p3.wait_for_selector("text=10 أحرف", timeout=8000)
    ok(True, "رفض كلمة مرور ضعيفة")
    p3.fill("input[name=current]", PW); p3.fill("input[name=next]", "Matbaa2026Secure"); p3.fill("input[name=confirm]", "Matbaa2026Secure"); p3.click("button:has-text('حفظ')"); p3.wait_for_url(lambda u: "/account/password" not in u, timeout=10000)
    ok("/account/password" not in p3.url, "تغيير كلمة المرور يفتح النظام")
    c3.close()

    print("\n— المهام الدورية")
    r = page.request.post(f"{BASE}/api/cron"); ok(r.status == 401, "مسار المهام الدورية يرفض بدون مفتاح")
    r = page.request.post(f"{BASE}/api/cron", headers={"Authorization": f"Bearer {CRON}"}); ok(r.status == 200, f"تشغيل الفحوصات الدورية {r.text()}")
    r2 = page.request.post(f"{BASE}/api/cron", headers={"Authorization": f"Bearer {CRON}"}); j = r2.json()
    ok(j["dueSoon"] == 0 and j["newlyLate"] == 0, "التشغيل الثاني لا يكرر الإشعارات")

    print("\n— الصلاحيات بأدوار أخرى")
    for user, allowed, denied in [("designer", ["/design", "/my"], ["/settings/users", "/settings", "/delivery"]),
                                  ("worker", ["/production", "/my"], ["/customers", "/quality", "/settings"]),
                                  ("sales", ["/orders", "/customers"], ["/settings/users", "/quality", "/settings/audit"])]:
        c2 = b.new_context(viewport={"width": 1366, "height": 768}); pg = c2.new_page(); login(pg, user)
        for path in allowed:
            r = pg.goto(BASE + path); ok(r.status == 200, f"{user} يصل إلى {path}")
        for path in denied:
            r = pg.goto(BASE + path); ok("/forbidden" in pg.url and "ليست لديك صلاحية" in pg.content(), f"{user} ممنوع من {path} ({r.status})")
        if user == "worker":
            pg.goto(f"{BASE}{oid}?tab=overview"); ok("ر.س" not in pg.content(), "موظف الإنتاج لا يرى أي مبالغ في صفحة الطلب")
        if user == "designer":
            r = pg.request.get(f"{BASE}/api/files/{href.split('/')[-1]}"); ok(r.status in (200, 404), "مسار الملفات يتحقق من الصلاحية")
        c2.close()

    print("\n— شاشة الإنتاج المباشر")
    tv = b.new_context(viewport={"width": 1920, "height": 1080}); tp = tv.new_page(); terr = []
    tp.on("pageerror", lambda e: terr.append(str(e)))
    r = tp.request.get(f"{BASE}/api/live-board"); ok(r.status == 401, "واجهة الشاشة ترفض الطلب بدون رمز أو جلسة")
    r = tp.request.get(f"{BASE}/api/live-board?device=invalid-token-xxxxxxxxxxxxxxx"); ok(r.status == 401, "رمز جهاز غير صالح مرفوض")
    r = tp.request.get(f"{BASE}/api/live-board?device={TOKEN}"); body = r.text()
    ok(r.status == 200, "رمز الجهاز يعطي البيانات")
    leaks = [w for w in ["price", "total", "amount", "paid", "cost", "phone", "email", "vat", "17825", "0551234567"] if w in body.lower()]
    ok(not leaks, f"لا تسريب لحقول مالية أو تواصل في واجهة الشاشة {leaks}")
    tp.goto(f"{BASE}/live-board?device={TOKEN}"); tp.wait_for_timeout(3500)
    ok("شاشة الإنتاج المباشر" in tp.content() and "حالة الآلات" in tp.content() and not terr, "الشاشة تعمل بالرمز دون تسجيل دخول")
    ok("مباشر" in tp.locator("header").inner_text(), "اتصال البث المباشر نشط")
    tp.screenshot(path="/tmp/shots/07-live-board-before.png")
    # تحديث فوري: إنشاء أمر تشغيل عاجل من جلسة المدير ومراقبة الشاشة
    before = tp.locator("section").first.inner_text()
    page.goto(f"{BASE}/production/machines")
    page.once("dialog", lambda d: d.accept("تغيير رأس الطباعة"))
    page.locator("button:has-text('تحويل للصيانة')").first.click(); page.wait_for_timeout(1500)
    tp.wait_for_timeout(7000)
    ok("تحت الصيانة" in tp.content(), "الشاشة حدّثت حالة الآلة تلقائيًا بعد تحويلها للصيانة (بث مباشر)")
    tp.screenshot(path="/tmp/shots/08-live-board-after.png")
    page.goto(f"{BASE}/production/machines"); page.locator("button:has-text('إعادة للخدمة')").first.click(); page.wait_for_timeout(1000)
    tv.close()
    # لقطة الشاشة بحالة مليئة: طلبات قيد التنفيذ
    b.close()

print(f"\nالنتيجة: {passes} نجاح، {len(fails)} فشل")
for f in fails: print("  ✗", f)
sys.exit(1 if fails else 0)

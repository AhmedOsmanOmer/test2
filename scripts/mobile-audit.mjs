/**
 * فحص التوافق مع الجوال والأجهزة اللوحية (اختبار فقط — على نسخة مبنية معزولة وقاعدة اختبار، لا يكتب في أي قاعدة).
 * لكل دور ولكل صفحة يصل إليها، وبكل مقاس شاشة:
 *  - يفشل إذا كانت الصفحة أعرض من الشاشة (تمرير أفقي) ويذكر العنصر المتسبب الأكبر؛
 *  - يفشل إذا كان أي زر/رابط/حقل ظاهر داخل المحتوى أصغر من 40×40 بكسل؛
 *  - يفحص الدرج الجانبي (فتح/إغلاق بـ Escape والخلفية والتنقل، وحصر التركيز)، وقائمة الجرس داخل الشاشة، وتبويبات صفحة الطلب؛
 *  - يحفظ لقطات كاملة في _report/mobile/<role>/<page>-<width>.png
 *
 * التشغيل:  node scripts/mobile-audit.mjs [--base http://localhost:3001] [--viewports 360x740,390x844,768x1024] [--roles admin,sales] [--no-shots]
 * كلمة المرور: SEED_ADMIN_PASSWORD من البيئة أو من .env (لا تُطبع). Playwright: من المشروع أو من _audit/node_modules.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = arg("base", "http://localhost:3001");
const VIEWPORTS = arg("viewports", "360x740,390x844,768x1024").split(",").map((v) => { const [w, h] = v.split("x").map(Number); return { width: w, height: h }; });
const ROLES = { admin: "SUPER_ADMIN", salessup: "SALES_SUPERVISOR", sales: "SALES", designer: "DESIGNER", worker: "PRODUCTION_WORKER", delivery: "DELIVERY" };
const USERS = arg("roles", Object.keys(ROLES).join(",")).split(",");
const SHOTS = !flag("no-shots");
const OUT = path.join(root, "_report", "mobile", arg("tag", ""));
const MIN = 40;

function loadPlaywright() {
  for (const base of [path.join(root, "package.json"), path.join(root, "_audit", "package.json")]) {
    try { return createRequire(base)("playwright"); } catch { /* التالي */ }
  }
  throw new Error("Playwright غير مثبت: npm i -D playwright أو استخدم _audit/node_modules");
}
function password() {
  if (process.env.SEED_ADMIN_PASSWORD) return process.env.SEED_ADMIN_PASSWORD;
  const m = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^SEED_ADMIN_PASSWORD\s*=\s*"?([^"\n]*)"?/m);
  if (!m) throw new Error("SEED_ADMIN_PASSWORD غير محدد");
  return m[1];
}
const { chromium } = loadPlaywright();
const shell = path.join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const browser = await chromium.launch(fs.existsSync(shell) ? { executablePath: shell } : {});
const PW = password();

/** داخل الصفحة: التمرير الأفقي والعنصر المتسبب، والعناصر الصغيرة داخل المحتوى */
const PROBE = (MIN) => {
  const vw = window.innerWidth;
  const sel = (el) => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += `#${e.id}`; parts.unshift(s); break; }
      const cls = [...e.classList].filter((c) => !c.includes(":") && !c.includes("[")).slice(0, 3);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
    }
    return parts.join(" > ");
  };
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === "fixed") return true;
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) return true;
    }
    return getComputedStyle(el).position === "fixed";
  };
  const overflow = document.documentElement.scrollWidth - vw;
  let offender = null;
  if (overflow > 1) {
    let best = 0;
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || clipped(el)) continue;
      const amount = Math.max(r.right - vw, -r.left);
      if (amount > best + 0.5) { best = amount; offender = { selector: sel(el), amount: Math.round(amount), width: Math.round(r.width), text: (el.innerText || "").trim().slice(0, 40) }; }
    }
  }
  const scope = document.querySelector("main") ?? document.body;
  const small = [];
  for (const el of scope.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], summary')) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[aria-hidden='true'], .sr-only, [hidden]") || el.classList.contains("sr-only")) continue;
    let target = el;
    if (el.matches("input[type=checkbox], input[type=radio]")) target = el.closest("label") ?? el;
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width < MIN - 0.5 || r.height < MIN - 0.5) small.push(`${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""} «${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || el.getAttribute("placeholder") || "").trim().slice(0, 30)}» ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // بلا viewport صحيح يصغّر الجوال الصفحة كلها لتتسع (لا تمرير، لكن النص غير مقروء)
  return { overflow: Math.round(overflow), offender, small, layoutWidth: window.innerWidth };
};

const results = [];
const record = (r) => { results.push(r); const bad = r.fail.length ? `✗ ${r.fail.join(" | ").slice(0, 300)}` : "✓"; console.log(`${r.user.padEnd(8)} ${String(r.width).padStart(4)} ${r.page.padEnd(28)} ${bad}`); };
const slug = (p) => (p === "/" ? "dashboard" : p.replace(/^\//, "").replace(/\?/, "_").replace(/[=&]/g, "-").replace(/\/c[a-z0-9]{20,}/g, "/id").replace(/[^\w؀-ۿ-]+/g, "_")).slice(0, 60);

async function login(ctx, u) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', u); await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((x) => !x.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), page.click('button[type="submit"], form button')]);
  if (page.url().includes("/login") || page.url().includes("/account/password")) throw new Error(`تعذّر دخول ${u} (أو يُطلب تغيير كلمة المرور)`);
  return page;
}

async function discover(page) {
  const links = async (p, re) => {
    const r = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }).catch(() => null);
    if (!r || r.status() >= 400 || /\/(forbidden|login)/.test(page.url())) return null;
    const hrefs = await page.$$eval("main a[href]", (as) => as.map((a) => a.getAttribute("href")));
    return hrefs.find((h) => re.test(h ?? "")) ?? null;
  };
  const list = ["/", "/my", "/customers", "/customers/new", "/orders", "/orders?view=kanban", "/orders/new", "/design", "/production", "/production?view=schedule",
    "/production/machines", "/quality", "/delivery", "/notifications", "/search?q=GP-2026", "/settings", "/settings/general", "/settings/users", "/settings/live-board",
    "/settings/audit", "/account/password", "/live-board"];
  const extra = [];
  const order = await links("/orders?view=table", /^\/orders\/c[a-z0-9]+$/);
  if (order) ["overview", "items", "design", "production", "quality", "delivery", "files", "comments", "timeline"].forEach((t) => extra.push(`${order}?tab=${t}`));
  for (const [p, re] of [["/customers", /^\/customers\/c[a-z0-9]+$/], ["/design", /^\/design\/c[a-z0-9]+$/], ["/production", /^\/production\/c[a-z0-9]+$/], ["/delivery", /^\/print\/delivery\/c[a-z0-9]+$/], ["/my", /^\/(production|design)\/c[a-z0-9]+$/]]) {
    const h = await links(p, re); if (h && !extra.includes(h)) extra.push(h);
  }
  return { pages: [...list, ...extra], order };
}

/** فحوصات الهيكل: الدرج والجرس وتبويبات الطلب */
async function shellChecks(page, width, order) {
  const fail = [];
  const phone = width < 1024;
  await page.goto(`${BASE}/my`, { waitUntil: "networkidle" });
  const burger = page.locator('[aria-controls="app-drawer"]');
  if (phone) {
    if (!(await burger.isVisible().catch(() => false))) fail.push("زر القائمة غير ظاهر");
    else {
      const drawer = page.locator("#app-drawer");
      const opened = async () => (await drawer.getAttribute("aria-hidden")) === "false" && (await drawer.isVisible());
      await burger.click(); await page.waitForTimeout(350);
      if (!(await opened())) fail.push("الدرج لا يفتح");
      const box = await drawer.boundingBox({ timeout: 3000 }).catch(() => null);
      if (box && (box.x < -1 || box.x + box.width > width + 1)) fail.push(`الدرج خارج الشاشة ${Math.round(box.x)}..${Math.round(box.x + box.width)}`);
      for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
      if (!(await page.evaluate(() => !!document.activeElement?.closest("#app-drawer")))) fail.push("التركيز يخرج من الدرج المفتوح");
      if ((await burger.getAttribute("aria-expanded")) !== "true") fail.push("aria-expanded لا يتغير");
      await page.keyboard.press("Escape"); await page.waitForTimeout(350);
      if (await opened()) fail.push("Escape لا يغلق الدرج");
      await burger.click(); await page.waitForTimeout(350);
      await page.mouse.click(width - 10 < 300 ? 10 : 10, 300); await page.waitForTimeout(350); // الخلفية (الجهة المقابلة للدرج)
      if (await opened()) fail.push("النقر على الخلفية لا يغلق الدرج");
      await burger.click(); await page.waitForTimeout(350);
      await drawer.locator('a[href="/notifications"]').click({ timeout: 3000 }).catch(() => fail.push("رابط في الدرج غير قابل للنقر"));
      await page.waitForURL(/\/notifications/, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
      if (await opened()) fail.push("الدرج لا يُغلق بعد التنقل");
    }
  } else if (await burger.isVisible().catch(() => false)) fail.push("زر القائمة ظاهر على سطح المكتب");
  // الجرس
  const bell = page.locator('[data-testid="bell"]');
  if (await bell.isVisible().catch(() => false)) {
    await bell.click(); await page.waitForTimeout(500);
    const panel = await page.locator('[data-testid="bell-panel"]').boundingBox({ timeout: 3000 }).catch(() => null);
    if (!panel) fail.push("قائمة الجرس لا تظهر");
    else if (panel.x < -1 || panel.x + panel.width > width + 1) fail.push(`قائمة الجرس خارج الشاشة ${Math.round(panel.x)}..${Math.round(panel.x + panel.width)}`);
    await page.keyboard.press("Escape");
  } else fail.push("الجرس غير ظاهر");
  // تبويبات الطلب
  if (order) {
    await page.goto(`${BASE}${order}`, { waitUntil: "networkidle" });
    const tabs = page.locator('nav[aria-label="أقسام الطلب"] a');
    const n = await tabs.count();
    if (!n && (await page.locator("nav a.tab").count())) fail.push("تبويبات الطلب بلا aria-label");
    if (!n) fail.push("تبويبات الطلب غير موجودة");
    for (let i = 0; i < n; i++) {
      const t = tabs.nth(i);
      await t.scrollIntoViewIfNeeded();
      const b = await t.boundingBox({ timeout: 3000 }).catch(() => null);
      const ok = b && b.x >= -1 && b.x + b.width <= width + 1 && (await t.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === el || el.contains(top)); }));
      if (!ok) fail.push(`تبويب غير قابل للوصول: ${(await t.innerText()).trim()}`);
    }
  }
  return fail;
}

const summary = {};
// صفحة الدخول (بلا جلسة)
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: vp, locale: "ar-SA", timezoneId: "Asia/Riyadh", hasTouch: vp.width < 1024, isMobile: vp.width < 1024 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const p = await page.evaluate(PROBE, MIN);
  const fail = [];
  if (p.layoutWidth > vp.width + 1) fail.push(`الصفحة مصغّرة لتتسع: عرض التخطيط ${p.layoutWidth}px على شاشة ${vp.width}px`);
  if (p.overflow > 1) fail.push(`تمرير أفقي ${p.overflow}px — ${p.offender?.selector}`);
  if (p.small.length) fail.push(`عناصر صغيرة: ${p.small.join("، ")}`);
  if (SHOTS) { fs.mkdirSync(path.join(OUT, "anonymous"), { recursive: true }); await page.screenshot({ path: path.join(OUT, "anonymous", `login-${vp.width}.png`), fullPage: true }); }
  record({ user: "anon", role: "-", width: vp.width, page: "/login", fail, ...p });
  await ctx.close();
}

for (const u of USERS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp, locale: "ar-SA", timezoneId: "Asia/Riyadh", hasTouch: vp.width < 1024, isMobile: vp.width < 1024 });
    const page = await login(ctx, u);
    const { pages, order } = await discover(page);
    const key = `${u}@${vp.width}`;
    summary[key] = { pages: 0, failed: 0, zoomed: 0, overflow: 0, small: 0, shell: 0 };
    for (const p of pages) {
      const resp = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }).catch(() => null);
      const url = page.url();
      if (!resp || resp.status() === 404 || /\/forbidden|\/login/.test(url) || (p !== "/" && new URL(url).pathname === "/my" && !p.startsWith("/my"))) continue;
      await page.waitForTimeout(p.startsWith("/live-board") ? 1500 : 200);
      const r = await page.evaluate(PROBE, MIN);
      const fail = [];
      if (r.layoutWidth > vp.width + 1) fail.push(`الصفحة مصغّرة لتتسع: عرض التخطيط ${r.layoutWidth}px على شاشة ${vp.width}px`);
      if (r.overflow > 1) fail.push(`تمرير أفقي ${r.overflow}px — ${r.offender ? `${r.offender.selector} (${r.offender.amount}px «${r.offender.text}»)` : "?"}`);
      if (r.small.length) fail.push(`عناصر أصغر من ${MIN}px (${r.small.length}): ${r.small.slice(0, 6).join("، ")}${r.small.length > 6 ? "…" : ""}`);
      if (SHOTS) { const dir = path.join(OUT, u); fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `${slug(p)}-${vp.width}.png`), fullPage: true }); }
      summary[key].pages++; if (fail.length) summary[key].failed++; if (r.layoutWidth > vp.width + 1) summary[key].zoomed++; if (r.overflow > 1) summary[key].overflow++; if (r.small.length) summary[key].small++;
      record({ user: u, role: ROLES[u], width: vp.width, page: p, fail, ...r });
    }
    const sf = await shellChecks(page, vp.width, order);
    summary[key].shell = sf.length;
    record({ user: u, role: ROLES[u], width: vp.width, page: "[shell: drawer/bell/tabs]", fail: sf });
    await ctx.close();
  }
}
await browser.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), summary, results }, null, 1));
console.log("\nالملخص (صفحات / فاشلة / مصغّرة / تمرير أفقي / عناصر صغيرة / فحوصات الهيكل):");
for (const [k, s] of Object.entries(summary)) console.log(`  ${k.padEnd(16)} ${s.pages} / ${s.failed} / ${s.zoomed} / ${s.overflow} / ${s.small} / ${s.shell}`);
const failing = results.filter((r) => r.fail.length).length;
console.log(`\n${failing ? `✗ ${failing} فحصًا فاشلًا` : "✓ لا مشاكل"} — النتائج في ${path.relative(root, OUT)}/results.json`);
process.exitCode = failing ? 1 : 0;

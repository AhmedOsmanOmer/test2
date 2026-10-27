/**
 * مشغّل التجربة المحلية بنقرة واحدة — لا يحتاج تثبيت PostgreSQL ولا إعداد يدوي.
 * يشغّل قاعدة بيانات مدمجة داخل مجلد المشروع (.runtime/pgdata) على المنفذ 5433،
 * ينشئ ملف .env تلقائيًا، يجهّز الجداول والبيانات التجريبية أول مرة، يبني النظام ويفتح المتصفح.
 * للتجربة على جهاز واحد فقط — ليس طريقة النشر على خادم الشركة.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const rt = path.join(root, ".runtime");
mkdirSync(rt, { recursive: true });
const PORT = Number(process.env.GP_PORT ?? 3000);
const say = (m) => console.log(`\n▶ ${m}`);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args, extraEnv = {}) => {
  const r = spawnSync(npx, args, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) { console.error(`\n✗ فشل الأمر: npx ${args.join(" ")}`); process.exit(1); }
};

// 1) ملف الإعدادات
let dbPassword;
let newAdminPassword = null; // تُطبع مرة واحدة فقط عند أول تشغيل
if (!existsSync(".env")) {
  dbPassword = randomBytes(12).toString("hex");
  newAdminPassword = `Gp-${randomBytes(6).toString("hex")}-7a`;
  writeFileSync(".env", [
    `DATABASE_URL="postgresql://postgres:${dbPassword}@127.0.0.1:5433/gp_erp?schema=public"`,
    `SESSION_SECRET="${randomBytes(32).toString("hex")}"`,
    `STORAGE_DIR="./storage"`,
    `APP_URL="http://localhost:${PORT}"`,
    `SEED_ADMIN_PASSWORD="${newAdminPassword}"`,
    `CRON_SECRET="${randomBytes(24).toString("hex")}"`,
  ].join("\n") + "\n");
  say("تم إنشاء ملف الإعدادات .env");
} else {
  dbPassword = readFileSync(".env", "utf8").match(/postgres:([^@]+)@127\.0\.0\.1:5433/)?.[1];
  if (!dbPassword) { console.error("ملف .env موجود لكنه لا يشير لقاعدة البيانات المدمجة. احذفه أو أعد تسميته ثم أعد التشغيل."); process.exit(1); }
}

// 2) قاعدة البيانات المدمجة
const dataDir = path.join(rt, "pgdata");
const pg = new EmbeddedPostgres({
  databaseDir: dataDir, port: 5433, user: "postgres", password: dbPassword, persistent: true,
  createPostgresUser: process.getuid?.() === 0, onLog: () => {}, onError: (e) => console.error(String(e)),
});
const firstTime = !existsSync(dataDir);
if (firstTime) { say("تجهيز قاعدة البيانات لأول مرة…"); await pg.initialise(); }
let reused = false;
try {
  const { default: pgc } = await import("pg");
  const c = new pgc.Client({ host: "127.0.0.1", port: 5433, user: "postgres", password: dbPassword, database: "postgres", connectionTimeoutMillis: 1500 });
  await c.connect(); await c.end(); reused = true;
  say("قاعدة البيانات تعمل مسبقًا من تشغيل سابق — سيتم استخدامها");
} catch { /* غير مشغلة */ }
if (!reused) { say("تشغيل قاعدة البيانات…"); await pg.start(); }
let stopping = false;
const shutdown = async (code = 0) => {
  if (stopping) return; stopping = true;
  console.log("\n■ جارٍ الإيقاف…");
  try { app?.kill("SIGTERM"); } catch {}
  if (!reused) { try { await pg.stop(); } catch {} }
  process.exit(code);
};
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0)); // إغلاق نافذة Terminal
let app;
try {
  if (firstTime) await pg.createDatabase("gp_erp");

  // 3) الجداول والبيانات التجريبية (أول مرة فقط)
  if (!existsSync(path.join(root, "src/generated/prisma"))) { say("توليد عميل قاعدة البيانات…"); run(["prisma", "generate"]); }
  const readyMarker = path.join(rt, "db-ready");
  if (!existsSync(readyMarker)) {
    say("إنشاء الجداول…");
    if (process.env.LAUNCHER_TEST_BOOTSTRAP === "1") run(["tsx", "scripts/sql-bootstrap.ts"]);
    else run(["prisma", "migrate", "deploy"]);
    say("إضافة الأدوار والبيانات التجريبية…");
    const r = spawnSync(npx, ["tsx", "prisma/seed.ts"], { env: { ...process.env, SEED_DEMO: "true" }, encoding: "utf8" });
    if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error("فشل إضافة البيانات"); }
    const token = r.stdout.match(/device=([\w-]+)/)?.[1];
    if (token) writeFileSync(path.join(rt, "live-board-link.txt"), `http://localhost:${PORT}/live-board?device=${token}\n`);
    writeFileSync(readyMarker, new Date().toISOString());
  }

  // 4) البناء (أول مرة أو بعد تحديث الكود)
  if (!existsSync(path.join(root, ".next/BUILD_ID"))) { say("بناء النظام (دقيقة أو دقيقتان أول مرة فقط)…"); run(["next", "build"], { NEXT_TELEMETRY_DISABLED: "1" }); }

  // 5) التشغيل وفتح المتصفح
  try { const r = await fetch(`http://localhost:${PORT}/login`); if (r) { console.error(`\n✗ المنفذ ${PORT} مستخدم (ربما النظام يعمل في نافذة أخرى). افتح http://localhost:${PORT} أو أغلق النافذة الأخرى.`); await shutdown(1); } } catch { /* المنفذ متاح */ }
  say("تشغيل النظام…");
  app = spawn(npx, ["next", "start", "-p", String(PORT)], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, NODE_ENV: "production" } });
  app.on("exit", (c) => { if (!stopping) { console.error(`توقف النظام (رمز ${c})`); shutdown(1); } });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/login`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const url = `http://localhost:${PORT}`;
  const link = existsSync(path.join(rt, "live-board-link.txt")) ? readFileSync(path.join(rt, "live-board-link.txt"), "utf8").trim() : "(افتحها من القائمة الجانبية بعد الدخول)";
  console.log(`
════════════════════════════════════════════════════
  ✅ النظام يعمل:   ${url}
  المستخدم: admin     ${newAdminPassword ? `كلمة المرور الأولية: ${newAdminPassword}\n  ⚠ احفظها الآن — لن تظهر مرة أخرى، وسيُطلب تغييرها عند أول دخول.` : "كلمة المرور: التي ظهرت عند أول تشغيل (أو التي غيّرتها بعده)"}
  (الحسابات التجريبية الأخرى تبدأ بنفس كلمة المرور الأولية)

  📺 شاشة الإنتاج:  ${link}

  للإيقاف: اضغط Control + C أو أغلق هذه النافذة
════════════════════════════════════════════════════`);
  if (process.env.LAUNCHER_NO_BROWSER !== "1") {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  }
} catch (e) {
  console.error("\n✗", e?.message ?? e);
  await shutdown(1);
}

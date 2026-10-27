import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { loadActor, type Actor } from "./actor";
import { audit } from "./services/audit";

const COOKIE = "gp_session";
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const IP_LIMIT_PER_15MIN = 30;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function clientIp() {
  const h = headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = clientIp();
  const generic = "اسم المستخدم أو كلمة المرور غير صحيحة";
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
  const ipFails = await db.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } });
  if (ipFails >= IP_LIMIT_PER_15MIN) return { ok: false, error: "محاولات كثيرة من هذا الجهاز. حاول بعد 15 دقيقة." };

  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  // نقارن دائمًا لتجنب كشف وجود المستخدم عبر زمن الاستجابة
  const valid = await bcrypt.compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  await db.loginAttempt.create({ data: { username, ip, success: !!(user && valid) } });

  if (!user || !user.isActive) return { ok: false, error: generic };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, error: "الحساب مقفل مؤقتًا بسبب محاولات فاشلة. حاول لاحقًا." };
  if (!valid) {
    const fails = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit(db, user.id, "LOGIN_FAILED", "User", user.id, null, { ip });
    return { ok: false, error: generic };
  }

  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: { id: hash(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000), ip, userAgent: headers().get("user-agent")?.slice(0, 200) },
  });
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit(db, user.id, "LOGIN", "User", user.id, null, { ip });
  cookies().set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600 });
  return { ok: true };
}

export async function logout() {
  const t = cookies().get(COOKIE)?.value;
  if (t) await db.session.deleteMany({ where: { id: hash(t) } });
  cookies().delete(COOKIE);
}

/** المستخدم الحالي أو null — التحقق الحقيقي على الخادم */
export async function currentActor(): Promise<Actor | null> {
  const t = cookies().get(COOKIE)?.value;
  if (!t) return null;
  const s = await db.session.findUnique({ where: { id: hash(t) } });
  if (!s || s.expiresAt < new Date()) return null;
  return loadActor(s.userId);
}

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect("/login");
  return a;
}

export const hashPassword = (p: string) => bcrypt.hash(p, 12);

/** سياسة كلمة المرور: 10 أحرف على الأقل وتجمع حروفًا وأرقامًا */
export function passwordProblem(p: string, username?: string): string | null {
  if (p.length < 10) return "كلمة المرور 10 أحرف على الأقل";
  if (!/[A-Za-z\u0600-\u06FF]/.test(p) || !/\d/.test(p)) return "يجب أن تحتوي كلمة المرور على حروف وأرقام";
  if (username && p.toLowerCase().includes(username.toLowerCase())) return "لا تستخدم اسم المستخدم داخل كلمة المرور";
  return null;
}

/** يغيّر كلمة مرور المستخدم الحالي ويُنهي جلساته الأخرى */
export async function changeOwnPassword(current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = cookies().get(COOKIE)?.value;
  const s = t ? await db.session.findUnique({ where: { id: hash(t) }, include: { user: true } }) : null;
  if (!s || s.expiresAt < new Date()) return { ok: false, error: "انتهت الجلسة" };
  if (!(await bcrypt.compare(current, s.user.passwordHash))) return { ok: false, error: "كلمة المرور الحالية غير صحيحة" };
  const problem = passwordProblem(next, s.user.username);
  if (problem) return { ok: false, error: problem };
  if (await bcrypt.compare(next, s.user.passwordHash)) return { ok: false, error: "اختر كلمة مرور مختلفة عن الحالية" };
  await db.user.update({ where: { id: s.userId }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  await db.session.deleteMany({ where: { userId: s.userId, id: { not: s.id } } });
  await audit(db, s.userId, "PASSWORD_CHANGE", "User", s.userId);
  return { ok: true };
}

/** للصفحات: بدل رمي خطأ 500، يحوّل غير المصرح له لصفحة واضحة (التحقق نفسه يبقى في الخدمات أيضًا) */
export function pagePerm(a: Actor, ...perms: import("@/lib/permissions").PermissionKey[]) {
  if (!perms.every((p) => a.permissions.has(p))) redirect("/forbidden");
}
export function pageAny(a: Actor, ...perms: import("@/lib/permissions").PermissionKey[]) {
  if (!perms.some((p) => a.permissions.has(p))) redirect("/forbidden");
}

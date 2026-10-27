import { readFileSync } from "node:fs";

// حد حجم الملف المرفوع: مصدر واحد يستخدمه الخادم (files.ts) وحد جسم الطلب هنا
const { uploadMaxMb } = JSON.parse(readFileSync(new URL("./src/lib/upload-limit.json", import.meta.url), "utf8"));
// وضع التطوير (next dev) يحتاج eval لتشغيل React في المتصفح؛ النسخة المبنية لا تحتاجه
const devEval = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // سياسة محتوى صارمة: لا موارد خارجية إطلاقًا (الخط مدمج محليًا)
  { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${devEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` },
];
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: `${uploadMaxMb + 1}mb` },
    // exceljs للخادم فقط: لا يُحزم ولا يصل لأي حزمة متصفح
    serverComponentsExternalPackages: ["exceljs"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;

/** رابط داخلي فقط (يبدأ بـ / وليس // أو /\ ولا يحتوي محارف تحكم) — وإلا صفحة الإشعارات. يمنع التحويل لمواقع خارجية */
export function safeInternalPath(link: string | null | undefined, fallback = "/notifications") {
  if (!link || !link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\") || /[\u0000-\u001f\\]/.test(link)) return fallback;
  return link;
}

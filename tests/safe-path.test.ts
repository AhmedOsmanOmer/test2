import { describe, it, expect } from "vitest";
import { safeInternalPath } from "@/lib/safe-path";

describe("safeInternalPath — لا تحويل لمواقع خارجية (F18)", () => {
  it("يقبل المسارات الداخلية", () => {
    expect(safeInternalPath("/orders/abc")).toBe("/orders/abc");
    expect(safeInternalPath("/orders/abc?tab=timeline#x")).toBe("/orders/abc?tab=timeline#x");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example", "", null, undefined, "/ok\nSet-Cookie:x", "/a\\b"])(
    "يرفض %s", (link) => expect(safeInternalPath(link as string)).toBe("/notifications"));
});

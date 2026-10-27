import { describe, it, expect, afterEach, vi } from "vitest";
import { uuid } from "@/lib/uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuid() آمن خارج السياق الآمن", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("يستخدم randomUUID عند توفره", () => {
    expect(uuid()).toMatch(V4);
  });
  it("بلا randomUUID (http على عنوان الشبكة): يعتمد getRandomValues ويعطي v4 صالحًا وفريدًا", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 500 }, () => uuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(V4);
  });
  it("randomUUID موجود لكنه يرمي خطأ: يستخدم البديل", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { randomUUID: () => { throw new Error("insecure"); }, getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    expect(uuid()).toMatch(V4);
  });
  it("بلا crypto إطلاقًا: لا يتعطل", () => {
    vi.stubGlobal("crypto", undefined);
    expect(uuid()).toMatch(V4);
  });
});

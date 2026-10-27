import { getBoardData, fingerprint } from "@/server/services/liveboard";
import { boardAccess } from "../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * بث مباشر (Server-Sent Events): يفحص الخادم التغييرات كل بضع ثوانٍ ويرسل البيانات فقط عند تغيّرها،
 * مع نبضة كل 20 ثانية لإبقاء الاتصال حيًا. يعيد المتصفح الاتصال تلقائيًا عند الانقطاع.
 */
export async function GET(req: Request) {
  const acc = await boardAccess(req);
  if (!acc) return new Response("unauthorized", { status: 401 });
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  const pollMs = Math.min(10, Math.max(2, acc.config.refreshSeconds)) * 1000;
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      let busy = false;
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { cleanup(); } };
      const tick = async () => {
        if (busy) return; busy = true;
        try {
          const data = await getBoardData(acc.config);
          const fp = fingerprint(data);
          if (fp !== last) { last = fp; send(`event: board\ndata: ${JSON.stringify({ config: acc.config, name: acc.name, data })}\n\n`); }
        } catch { send(`event: problem\ndata: {}\n\n`); }
        busy = false;
      };
      const cleanup = () => { clearInterval(timer); clearInterval(beat); try { controller.close(); } catch { /* مغلق */ } };
      send("retry: 5000\n\n");
      await tick();
      timer = setInterval(tick, pollMs);
      beat = setInterval(() => send(": ping\n\n"), 20_000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() { clearInterval(timer); clearInterval(beat); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

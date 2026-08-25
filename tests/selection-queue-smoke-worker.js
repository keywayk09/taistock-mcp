export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
    if (!env.SMOKE_TOKEN || token !== env.SMOKE_TOKEN) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({
        ok: true,
        service: "taistock-selection-queue-smoke",
        cron: false,
        production_worker_touched: false,
        queue_binding: Boolean(env.SELECTION_SMOKE_QUEUE),
        kv_binding: Boolean(env.SMOKE_KV),
      });
    }

    if (url.pathname === "/enqueue" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = String(body?.id || "").trim();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
        return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
      }
      await env.SELECTION_SMOKE_QUEUE.send({
        schema: "taistock-selection-queue-smoke/v1",
        id,
        sent_at: new Date().toISOString(),
      });
      return Response.json({ ok: true, status: "ENQUEUED", id });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const id = String(url.searchParams.get("id") || "").trim();
      const raw = id ? await env.SMOKE_KV.get(`ack:${id}`) : null;
      if (!raw) return Response.json({ ok: true, status: "PENDING", id }, { status: 202 });
      return new Response(raw, { status: 200, headers: { "content-type": "application/json" } });
    }

    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  },

  async queue(batch, env) {
    for (const message of batch.messages || []) {
      const body = message.body || {};
      if (body.schema !== "taistock-selection-queue-smoke/v1" || !body.id) {
        message.retry();
        continue;
      }
      const receipt = {
        ok: true,
        status: "QUEUE_SMOKE_PASS",
        id: String(body.id),
        queue_consumer_acked: true,
        received_at: new Date().toISOString(),
      };
      await env.SMOKE_KV.put(`ack:${body.id}`, JSON.stringify(receipt), { expirationTtl: 300 });
      message.ack();
    }
  },
};

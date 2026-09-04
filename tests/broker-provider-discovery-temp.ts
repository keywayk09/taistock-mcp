function uniq<T>(values: T[]) { return [...new Set(values)]; }

const base = "https://www.nstock.tw";
const pageUrl = `${base}/stock_info?status=9&stock_id=2317`;
const page = await fetch(pageUrl, {
  headers: {
    "user-agent": "Mozilla/5.0 (compatible; taistock-readonly-provider-discovery/1.0)",
    accept: "text/html,application/xhtml+xml",
  },
});
const html = await page.text();
const scripts = uniq([...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]));
console.log("BROKER_PROVIDER_CLIENT_DISCOVERY", JSON.stringify({ page_http: page.status, scripts }));

for (const src of scripts) {
  const url = new URL(src, base).toString();
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 taistock-readonly-provider-discovery/1.0" } });
    const js = await response.text();
    const markers = ["branchData", "updatedDate", "stock_info", "status:9", "status=9", "branch", "券商"].filter((marker) => js.includes(marker));
    if (!markers.length) continue;
    const excerpts: string[] = [];
    for (const marker of markers) {
      let from = 0;
      for (let i = 0; i < 4; i += 1) {
        const index = js.indexOf(marker, from);
        if (index < 0) break;
        excerpts.push(js.slice(Math.max(0, index - 700), Math.min(js.length, index + 1800)).replace(/\s+/g, " "));
        from = index + marker.length;
      }
    }
    const urls = uniq([...js.matchAll(/["'`](https?:\\?\/\\?\/[^"'`]+|\\?\/[^"'`]*(?:api|branch|stock)[^"'`]*)["'`]/gi)].map((m) => m[1])).slice(0, 80);
    console.log("BROKER_PROVIDER_CLIENT_CHUNK", JSON.stringify({ url, http: response.status, bytes: js.length, markers, urls, excerpts: excerpts.slice(0, 12) }));
  } catch (error) {
    console.log("BROKER_PROVIDER_CLIENT_CHUNK", JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) }));
  }
}

console.log("TEMP broker provider client discovery complete");

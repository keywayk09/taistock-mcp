function uniq<T>(values: T[]) { return [...new Set(values)]; }

async function probe(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; taistock-readonly-provider-discovery/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await response.text();
    const dateRanges = uniq([...html.matchAll(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\s*(?:~|～|-)?\s*(?:(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2}))?/g)].map((m) => m[0])).slice(0, 12);
    const hrefs = uniq([...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((value) => /branch|stock_info|day=|status=9|broker/i.test(value))).slice(0, 30);
    const forms = uniq([...html.matchAll(/<form\b[^>]*[\s\S]*?<\/form>/gi)].map((m) => m[0].replace(/\s+/g, " ").slice(0, 1200))).slice(0, 5);
    const inputs = uniq([...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, " ")).filter((value) => /date|day|start|end|from|to|no=|stock/i.test(value))).slice(0, 30);
    const scripts = uniq([...html.matchAll(/(?:fetch|axios\.(?:get|post)|\$\.ajax|\$\.get|\$\.post)\s*\(([^\n;]{0,500})/gi)].map((m) => m[0].replace(/\s+/g, " "))).slice(0, 20);
    const apiStrings = uniq([...html.matchAll(/["']([^"']*(?:api|ajax|branch|broker|stock_info)[^"']*)["']/gi)].map((m) => m[1]).filter((value) => value.length < 400)).slice(0, 60);
    console.log("BROKER_PROVIDER_DISCOVERY", JSON.stringify({
      url,
      http: response.status,
      content_type: response.headers.get("content-type"),
      bytes: html.length,
      dateRanges,
      hrefs,
      inputs,
      forms,
      scripts,
      apiStrings,
    }));
  } catch (error) {
    console.log("BROKER_PROVIDER_DISCOVERY", JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) }));
  }
}

await probe("https://histock.tw/stock/branch.aspx?no=2317");
await probe("https://histock.tw/stock/branch.aspx?no=2317&day=7");
await probe("https://histock.tw/stock/branch.aspx?no=2317&day=30");
await probe("https://www.nstock.tw/stock_info?status=9&stock_id=2317");

console.log("TEMP broker provider discovery probe complete");

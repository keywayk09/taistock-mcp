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
    const branchIndex = html.indexOf("branchData:[");
    const branchSnippet = branchIndex >= 0
      ? html.slice(branchIndex, branchIndex + 28_000).replace(/\s+/g, " ")
      : null;
    const dayTokens = uniq([...html.matchAll(/(?:days?|day|period|range|tab|title|name)["']?\s*[:=]\s*["']?([0-9]{1,3})["']?/gi)].map((m) => m[0])).slice(0, 80);
    const updateTokens = uniq([...html.matchAll(/(?:更新日期|update(?:Date|Time)?|lastUpdated)[^,}\]]{0,100}/gi)].map((m) => m[0])).slice(0, 30);
    console.log("BROKER_PROVIDER_DISCOVERY_DETAIL", JSON.stringify({
      url,
      http: response.status,
      content_type: response.headers.get("content-type"),
      bytes: html.length,
      dateRanges,
      dayTokens,
      updateTokens,
      branchIndex,
      branchSnippet,
    }));
  } catch (error) {
    console.log("BROKER_PROVIDER_DISCOVERY_DETAIL", JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) }));
  }
}

await probe("https://www.nstock.tw/stock_info?status=9&stock_id=2317");

console.log("TEMP broker provider discovery detail probe complete");

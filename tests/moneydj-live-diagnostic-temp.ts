const urls = [
  "https://www.moneydj.com/z/zc/zco/zco.djhtm?a=2419&e=2026-09-04&f=2026-09-04",
  "https://concords.moneydj.com/z/zc/zco/zco.djhtm?a=2419&e=2026-09-04&f=2026-09-04",
  "https://5850web.moneydj.com/z/zc/zco/zco.djhtm?a=2419&e=2026-09-04&f=2026-09-04",
];

function markerSummary(text: string) {
  const normalized = text.replace(/\s+/g, " ");
  const markers = ["最後更新日", "最後更新日期", "更新日期", "資料日期", "券商分點", "進出明細", "買超券商", "賣超券商"]
    .filter((marker) => normalized.includes(marker));
  const dateMatches = [...normalized.matchAll(/20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}/g)].map((m) => m[0]).slice(0, 8);
  const idx = Math.max(0, normalized.search(/(?:最後更新|更新日期|資料日期|券商分點|進出明細)/));
  return { markers, dateMatches, snippet: normalized.slice(idx, idx + 900) };
}

for (const url of urls) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,*/*",
        "user-agent": "Diamond-Broker-Live-Diagnostic/1.0",
      },
    });
    const bytes = await response.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(bytes);
    let big5 = "";
    try { big5 = new TextDecoder("big5").decode(bytes); } catch {}
    console.log("MONEYDJ_LIVE_DIAGNOSTIC", JSON.stringify({
      requested_url: url,
      final_url: response.url,
      status: response.status,
      content_type: response.headers.get("content-type"),
      bytes: bytes.byteLength,
      utf8: markerSummary(utf8),
      big5: markerSummary(big5),
    }));
  } catch (error) {
    console.log("MONEYDJ_LIVE_DIAGNOSTIC", JSON.stringify({ requested_url: url, error: error instanceof Error ? error.message : String(error) }));
  }
}

console.log("TEMP MoneyDJ live diagnostic complete");

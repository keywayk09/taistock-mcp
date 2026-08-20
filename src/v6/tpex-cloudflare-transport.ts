const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function getTpexJson(url: string, label: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: "https://www.tpex.org.tw/",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 200)}`);
  try {
    const body = JSON.parse(text);
    if (!Array.isArray(body) || !body.length) throw new Error(`${label}_empty`);
    return body;
  } catch (error) {
    if (error instanceof Error && error.message === `${label}_empty`) throw error;
    throw new Error(`${label}_invalid_json:${text.slice(0, 200)}`);
  }
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok } from "./common";

const fixedRules = [
  "使用者輸入『日期+台股』，例如『8/5台股』或『2026/08/05 台股』時，必須優先套用本契約。",
  "最終輸出必須是三個彼此獨立的UTF-8 TXT：台股資金流入、台股資金流出、台股融資融券觀察；禁止合併成一個檔案。",
  "三份TXT都採精簡排行加五張卡片格式，不使用A-1、A-2、B-1、C-1等章節編號。",
  "法人前十名必須排除ETF、槓桿ETF及反向ETF，並以一整行『代號名稱張數』呈現。",
  "只使用指定交易日的資料；資料尚未公告或無法驗證時，必須明確標示資料狀態，禁止拿前一交易日資料替代。",
  "不得自行加入逐檔收盤價、支撐、壓力、失效條件、長篇風險聲明或其他未列入固定欄位的內容。",
  "卡片評分代表籌碼品質與延續性，不是單純依當日漲跌幅評分。",
  "操作建議必須保留『操作建議👉』；資金流入使用🟢、資金流出使用🔻、融資融券使用🟡。",
];

const inflowCardFields = [
  "代表股",
  "籌碼",
  "反人性",
  "評分",
  "操作建議👉",
  "族群＆個股現象",
  "解讀",
  "延續性觀察",
];

const outflowCardFields = [...inflowCardFields];

const marginCardFields = [
  "代表股",
  "融資",
  "融券",
  "停券/回補",
  "反人性",
  "評分",
  "操作建議👉",
  "延續性觀察",
];

export function registerDailyReportFormatTool(server: McpServer) {
  server.registerTool(
    "prepare_daily_taiwan_stock_reports",
    {
      description:
        "『日期+台股』固定輸出契約。當使用者輸入8/5台股、2026/08/05台股、日期＋台股或要求當日台股資金流向時，必須先呼叫本工具。它規定最終一定產生三個獨立TXT：資金流入、資金流出、融資融券觀察，並固定採精簡排行＋五張卡片格式。後續再搭配大盤、法人與融資融券資料工具取得指定交易日數據。",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "date必須為YYYY-MM-DD")
          .describe("要整理的台股交易日，格式YYYY-MM-DD"),
      },
    },
    async ({ date }) => {
      const displayDate = date.replaceAll("-", "/");
      return ok({
        contract_version: "2026-08-06",
        trigger: `${displayDate} 台股`,
        requested_date: date,
        required_output_count: 3,
        fixed_rules: fixedRules,
        outputs: [
          {
            file_name: `${date}台股資金流入.txt`,
            title: `${displayDate} 台股資金流入`,
            order: [
              "大盤摘要：以三句內濃縮加權指數點位、漲跌、漲幅、成交值、上市三大法人及盤面定性",
              "外資買超前十（排除ETF）：十檔以頓號串成一整行",
              "投信買超前十（排除ETF）：十檔以頓號串成一整行",
              "五張🟢卡片",
            ],
            card_title_format: "🟢卡片N｜族群名稱",
            card_fields: inflowCardFields,
            notes: [
              "五張卡片應依當日主要流入族群重新分組，不固定套用前一日族群。",
              "籌碼欄列出代表股的外資、投信或雙法人關鍵張數。",
              "反人性欄優先指出價格與籌碼背離、法人分歧或急漲後追價風險。",
            ],
          },
          {
            file_name: `${date}台股資金流出.txt`,
            title: `${displayDate} 台股資金流出`,
            order: [
              "外資賣超前十（排除ETF）：十檔以頓號串成一整行",
              "投信賣超前十（排除ETF）：十檔以頓號串成一整行",
              "五張🔻卡片",
            ],
            card_title_format: "🔻卡片N｜族群名稱",
            card_fields: outflowCardFields,
            notes: [
              "資金流出檔不放大盤摘要。",
              "五張卡片應聚焦法人集中賣超、利用反彈調節、價格與籌碼背離及弱於大盤的族群。",
              "不得把單純股價下跌等同法人出貨，必須以指定日法人數據支持。",
            ],
          },
          {
            file_name: `${date}台股融資融券觀察.txt`,
            title: `${displayDate} 台股融資融券觀察`,
            order: [
              "資料狀態：說明資料來源更新日期，並聲明全部採指定日資料、不沿用前一日數據",
              "五張🟡卡片",
            ],
            card_title_format: "🟡卡片N｜資券主題",
            card_fields: marginCardFields,
            notes: [
              "每張卡片的融資與融券都要同時列當日增減及最新餘額，例如『+1,000至20,000張』。",
              "停券/回補欄要辨識資增券減、資減券增、資券同步增加、空單回補與已知停券事件。",
              "若指定日融資融券排行尚未完整公告，仍建立第三份TXT，但只寫清楚資料狀態；禁止以舊資料硬湊五張卡片。",
            ],
          },
        ],
        completion_checklist: [
          "是否正好三個TXT且彼此分開",
          "日期是否全部一致",
          "法人排行是否排除ETF且各十檔一整行",
          "三份檔案是否各有固定五張卡片，或融資融券未公告時明確停止填卡",
          "卡片欄位、emoji、星等與操作建議👉是否完全保留",
          "是否未混入前一交易日數據",
        ],
      });
    },
  );
}

export type SeedTheme = {
  theme_id: string;
  name_zh: string;
  name_en: string;
  parent_theme_id: string | null;
  theme_type: "sector" | "industry" | "sub_industry" | "theme" | "product" | "technology" | "supply_chain";
  aliases: string[];
  description: string;
};

export type SeedCompany = {
  company_id: string;
  country: string;
  exchange: string;
  ticker: string;
  company_name: string;
  company_name_en: string;
  aliases: string[];
  official_industry: string;
  sub_industry: string;
  website: string;
};

export type SeedMembership = {
  company_id: string;
  theme_id: string;
  role: string;
  relevance_score: number;
  evidence_level: "official" | "high" | "medium";
};

const t = (
  theme_id: string,
  name_zh: string,
  name_en: string,
  parent_theme_id: string | null,
  theme_type: SeedTheme["theme_type"],
  aliases: string[] = [],
  description = "",
): SeedTheme => ({ theme_id, name_zh, name_en, parent_theme_id, theme_type, aliases, description });

export const CORE_THEMES: SeedTheme[] = [
  t("semiconductor", "半導體", "Semiconductor", null, "sector", ["晶片", "半導體產業"]),
  t("semiconductor.design", "IC設計", "Fabless IC Design", "semiconductor", "industry", ["Fabless"]),
  t("semiconductor.foundry", "晶圓代工", "Semiconductor Foundry", "semiconductor", "industry", ["Foundry"]),
  t("semiconductor.memory", "記憶體", "Memory", "semiconductor", "industry", ["DRAM", "NAND"]),
  t("semiconductor.hbm", "HBM高頻寬記憶體", "High Bandwidth Memory", "semiconductor.memory", "technology", ["HBM", "高頻寬記憶體"]),
  t("semiconductor.packaging", "封裝測試", "Semiconductor Packaging and Test", "semiconductor", "industry", ["OSAT", "封測"]),
  t("semiconductor.advanced_packaging", "先進封裝", "Advanced Packaging", "semiconductor.packaging", "technology", ["CoWoS", "SoIC", "Chiplet"]),
  t("semiconductor.equipment", "半導體設備", "Semiconductor Equipment", "semiconductor", "industry", ["晶圓設備"]),
  t("semiconductor.materials", "半導體材料", "Semiconductor Materials", "semiconductor", "industry", ["晶圓材料", "電子材料"]),
  t("semiconductor.eda", "EDA與矽智財", "EDA and Semiconductor IP", "semiconductor", "industry", ["EDA", "矽智財", "IP"]),

  t("ai", "人工智慧", "Artificial Intelligence", null, "sector", ["AI"]),
  t("ai.accelerator", "AI加速器", "AI Accelerator", "ai", "technology", ["GPU", "AI晶片", "NPU"]),
  t("ai.server", "AI伺服器", "AI Server", "ai", "supply_chain", ["GPU伺服器", "AI Server"]),
  t("ai.cloud", "雲端與CSP", "Cloud and Hyperscaler", "ai", "industry", ["CSP", "Hyperscaler", "雲端服務"]),
  t("ai.edge", "邊緣AI", "Edge AI", "ai", "technology", ["AI PC", "AI手機", "Edge AI"]),
  t("ai.software", "AI軟體與資料平台", "AI Software and Data Platform", "ai", "industry", ["生成式AI", "企業AI"]),

  t("datacenter", "資料中心", "Data Center", null, "sector", ["IDC", "Data Centre"]),
  t("datacenter.power", "資料中心電源", "Data Center Power", "datacenter", "sub_industry", ["UPS", "PSU", "備援電源"]),
  t("datacenter.cooling", "資料中心散熱", "Data Center Cooling", "datacenter", "sub_industry", ["散熱", "Cooling"]),
  t("datacenter.liquid_cooling", "液冷散熱", "Liquid Cooling", "datacenter.cooling", "technology", ["水冷", "冷板", "CDU", "液冷"]),
  t("datacenter.network", "資料中心高速網路", "Data Center Networking", "datacenter", "sub_industry", ["高速交換器", "Ethernet", "InfiniBand"]),
  t("datacenter.rack", "伺服器機櫃與機殼", "Server Rack and Chassis", "datacenter", "sub_industry", ["機櫃", "機殼", "Rack"]),

  t("electronics", "電子零組件", "Electronic Components", null, "sector", ["電子元件"]),
  t("electronics.pcb", "PCB印刷電路板", "Printed Circuit Board", "electronics", "industry", ["PCB"]),
  t("electronics.ccl", "CCL銅箔基板", "Copper Clad Laminate", "electronics.pcb", "sub_industry", ["CCL", "銅箔基板"]),
  t("electronics.substrate", "IC載板", "IC Substrate", "electronics.pcb", "sub_industry", ["ABF載板", "BT載板"]),
  t("electronics.connector", "連接器", "Connector", "electronics", "industry", ["高速連接器"]),
  t("electronics.passive", "被動元件", "Passive Components", "electronics", "industry", ["MLCC", "電阻", "電感"]),
  t("electronics.power", "電源供應器", "Power Supply", "electronics", "industry", ["PSU", "Power Supply"]),
  t("electronics.optics", "光學元件", "Optical Components", "electronics", "industry", ["鏡頭", "光學"]),

  t("network", "網路通訊", "Networking and Communications", null, "sector", ["通訊", "Networking"]),
  t("network.optical", "光通訊", "Optical Communications", "network", "industry", ["光模組", "Optical Transceiver"]),
  t("network.silicon_photonics", "矽光子", "Silicon Photonics", "network.optical", "technology", ["CPO", "共同封裝光學", "Silicon Photonics"]),
  t("network.wifi", "Wi-Fi與寬頻", "Wi-Fi and Broadband", "network", "industry", ["WiFi", "寬頻"]),
  t("network.satellite", "低軌衛星", "Low Earth Orbit Satellite", "network", "supply_chain", ["LEO", "衛星通訊"]),

  t("automation", "自動化與機器人", "Automation and Robotics", null, "sector", ["機器人", "Automation"]),
  t("automation.robot", "工業機器人", "Industrial Robot", "automation", "industry", ["Robot", "機械手臂"]),
  t("automation.motion", "運動控制與傳動", "Motion Control", "automation", "sub_industry", ["伺服馬達", "線性滑軌", "減速機"]),
  t("automation.machine_vision", "機器視覺", "Machine Vision", "automation", "technology", ["視覺檢測"]),
  t("automation.humanoid", "人形機器人", "Humanoid Robot", "automation", "theme", ["Humanoid"]),

  t("vehicle", "汽車與智慧移動", "Automotive and Smart Mobility", null, "sector", ["車用"]),
  t("vehicle.ev", "電動車", "Electric Vehicle", "vehicle", "industry", ["EV"]),
  t("vehicle.battery", "電池", "Battery", "vehicle.ev", "industry", ["鋰電池", "Battery"]),
  t("vehicle.battery_material", "電池材料", "Battery Materials", "vehicle.battery", "sub_industry", ["正極", "負極", "電解液", "隔離膜"]),
  t("vehicle.power_semiconductor", "功率半導體", "Power Semiconductor", "vehicle", "industry", ["SiC", "GaN", "IGBT"]),
  t("vehicle.adas", "ADAS與自駕", "ADAS and Autonomous Driving", "vehicle", "technology", ["自動駕駛", "ADAS"]),

  t("energy", "能源與電力", "Energy and Power", null, "sector", ["電力"]),
  t("energy.grid", "重電與電網", "Power Grid and Heavy Electrical", "energy", "industry", ["重電", "電網"]),
  t("energy.storage", "儲能", "Energy Storage", "energy", "industry", ["ESS"]),
  t("energy.solar", "太陽能", "Solar Energy", "energy", "industry", ["光伏", "PV"]),
  t("energy.wind", "風力發電", "Wind Energy", "energy", "industry", ["風電"]),
  t("energy.nuclear", "核能", "Nuclear Energy", "energy", "industry", ["核電", "SMR"]),

  t("aerospace", "航太與國防", "Aerospace and Defense", null, "sector", ["軍工", "國防"]),
  t("aerospace.defense", "國防軍工", "Defense", "aerospace", "industry", ["軍工"]),
  t("aerospace.drone", "無人機", "Drone", "aerospace", "theme", ["UAV"]),
  t("aerospace.space", "太空產業", "Space Industry", "aerospace", "industry", ["Space"]),

  t("healthcare", "生技醫療", "Healthcare and Biotechnology", null, "sector", ["生技", "醫療"]),
  t("healthcare.biotech", "生技製藥", "Biotechnology and Pharma", "healthcare", "industry", ["新藥", "製藥"]),
  t("healthcare.medical_device", "醫療器材", "Medical Device", "healthcare", "industry", ["醫材"]),
  t("healthcare.cro", "CRO與CDMO", "CRO and CDMO", "healthcare", "industry", ["CRO", "CDMO"]),

  t("materials", "原物料與材料", "Materials and Commodities", null, "sector", ["原物料"]),
  t("materials.copper", "銅與銅箔", "Copper and Copper Foil", "materials", "industry", ["銅價", "銅箔"]),
  t("materials.glass_fiber", "玻纖布與玻璃纖維", "Glass Fiber", "materials", "industry", ["玻纖布"]),
  t("materials.rare_earth", "稀土與關鍵礦物", "Rare Earth and Critical Minerals", "materials", "industry", ["稀土"]),

  t("transport", "運輸與物流", "Transportation and Logistics", null, "sector", ["運輸"]),
  t("transport.shipping", "貨櫃航運", "Container Shipping", "transport", "industry", ["航運"]),
  t("transport.bulk", "散裝航運", "Dry Bulk Shipping", "transport", "industry", ["散裝"]),
  t("transport.air", "航空", "Airlines", "transport", "industry", ["航空業"]),

  t("consumer", "消費與品牌", "Consumer and Brands", null, "sector", ["消費"]),
  t("consumer.apple", "Apple供應鏈", "Apple Supply Chain", "consumer", "supply_chain", ["蘋果供應鏈", "iPhone供應鏈"]),
  t("consumer.gaming", "遊戲與娛樂", "Gaming and Entertainment", "consumer", "industry", ["遊戲"]),
  t("consumer.retail", "零售與通路", "Retail and Distribution", "consumer", "industry", ["通路"]),

  t("finance", "金融", "Financials", null, "sector", ["金融業"]),
  t("finance.bank", "銀行", "Banking", "finance", "industry", ["銀行業"]),
  t("finance.insurance", "保險", "Insurance", "finance", "industry", ["保險業"]),
  t("finance.broker", "證券與金融科技", "Brokerage and Fintech", "finance", "industry", ["券商", "Fintech"]),
];

const c = (
  company_id: string,
  country: string,
  exchange: string,
  ticker: string,
  company_name: string,
  company_name_en: string,
  aliases: string[],
  official_industry: string,
  sub_industry: string,
  website: string,
): SeedCompany => ({ company_id, country, exchange, ticker, company_name, company_name_en, aliases, official_industry, sub_industry, website });

export const CORE_GLOBAL_COMPANIES: SeedCompany[] = [
  c("US:NASDAQ:NVDA", "US", "NASDAQ", "NVDA", "輝達", "NVIDIA", ["Nvidia", "英偉達"], "Semiconductors", "GPU and AI Accelerators", "https://www.nvidia.com"),
  c("US:NASDAQ:AMD", "US", "NASDAQ", "AMD", "超微", "Advanced Micro Devices", ["AMD"], "Semiconductors", "CPU and GPU", "https://www.amd.com"),
  c("US:NASDAQ:AVGO", "US", "NASDAQ", "AVGO", "博通", "Broadcom", ["Broadcom"], "Semiconductors", "Networking and ASIC", "https://www.broadcom.com"),
  c("US:NASDAQ:INTC", "US", "NASDAQ", "INTC", "英特爾", "Intel", ["Intel"], "Semiconductors", "CPU and Foundry", "https://www.intel.com"),
  c("US:NASDAQ:QCOM", "US", "NASDAQ", "QCOM", "高通", "Qualcomm", ["Qualcomm"], "Semiconductors", "Wireless and Edge AI", "https://www.qualcomm.com"),
  c("US:NASDAQ:MU", "US", "NASDAQ", "MU", "美光", "Micron Technology", ["Micron"], "Semiconductors", "Memory", "https://www.micron.com"),
  c("US:NASDAQ:AMAT", "US", "NASDAQ", "AMAT", "應用材料", "Applied Materials", ["Applied Materials"], "Semiconductor Equipment", "Wafer Fabrication Equipment", "https://www.appliedmaterials.com"),
  c("US:NASDAQ:LRCX", "US", "NASDAQ", "LRCX", "科林研發", "Lam Research", ["Lam Research"], "Semiconductor Equipment", "Etch and Deposition", "https://www.lamresearch.com"),
  c("US:NASDAQ:KLAC", "US", "NASDAQ", "KLAC", "科磊", "KLA", ["KLA"], "Semiconductor Equipment", "Process Control", "https://www.kla.com"),
  c("NL:NASDAQ:ASML", "NL", "NASDAQ", "ASML", "艾司摩爾", "ASML", ["ASML"], "Semiconductor Equipment", "Lithography", "https://www.asml.com"),
  c("US:NASDAQ:MSFT", "US", "NASDAQ", "MSFT", "微軟", "Microsoft", ["Microsoft"], "Software", "Cloud and AI", "https://www.microsoft.com"),
  c("US:NASDAQ:GOOGL", "US", "NASDAQ", "GOOGL", "Alphabet", "Alphabet", ["Google", "谷歌"], "Interactive Media", "Cloud and AI", "https://abc.xyz"),
  c("US:NASDAQ:AMZN", "US", "NASDAQ", "AMZN", "亞馬遜", "Amazon", ["AWS", "Amazon"], "Internet Retail", "Cloud and E-commerce", "https://www.amazon.com"),
  c("US:NASDAQ:META", "US", "NASDAQ", "META", "Meta", "Meta Platforms", ["Facebook", "Meta"], "Interactive Media", "AI and Social Platforms", "https://about.meta.com"),
  c("US:NYSE:ORCL", "US", "NYSE", "ORCL", "甲骨文", "Oracle", ["Oracle"], "Software", "Cloud Infrastructure", "https://www.oracle.com"),
  c("US:NYSE:DELL", "US", "NYSE", "DELL", "戴爾", "Dell Technologies", ["Dell"], "Technology Hardware", "Servers and PCs", "https://www.dell.com"),
  c("US:NYSE:HPE", "US", "NYSE", "HPE", "慧與科技", "Hewlett Packard Enterprise", ["HPE"], "Technology Hardware", "Enterprise Servers and Networking", "https://www.hpe.com"),
  c("US:NASDAQ:SMCI", "US", "NASDAQ", "SMCI", "美超微", "Super Micro Computer", ["Supermicro"], "Technology Hardware", "AI Servers", "https://www.supermicro.com"),
  c("US:NYSE:ANET", "US", "NYSE", "ANET", "Arista", "Arista Networks", ["Arista"], "Communications Equipment", "Data Center Networking", "https://www.arista.com"),
  c("US:NYSE:VRT", "US", "NYSE", "VRT", "維諦", "Vertiv", ["Vertiv"], "Electrical Equipment", "Data Center Power and Cooling", "https://www.vertiv.com"),
  c("US:NASDAQ:AAPL", "US", "NASDAQ", "AAPL", "蘋果", "Apple", ["Apple"], "Technology Hardware", "Consumer Electronics", "https://www.apple.com"),
  c("US:NASDAQ:TSLA", "US", "NASDAQ", "TSLA", "特斯拉", "Tesla", ["Tesla"], "Automobiles", "EV and Energy Storage", "https://www.tesla.com"),
  c("US:NYSE:ETN", "US", "NYSE", "ETN", "伊頓", "Eaton", ["Eaton"], "Electrical Equipment", "Power Management", "https://www.eaton.com"),
  c("US:NYSE:GEV", "US", "NYSE", "GEV", "GE Vernova", "GE Vernova", ["GEV"], "Electrical Equipment", "Grid and Power Generation", "https://www.gevernova.com"),

  c("JP:TSE:8035", "JP", "TSE", "8035", "東京威力科創", "Tokyo Electron", ["TEL"], "Semiconductor Equipment", "Wafer Fabrication Equipment", "https://www.tel.com"),
  c("JP:TSE:6857", "JP", "TSE", "6857", "愛德萬測試", "Advantest", ["Advantest"], "Semiconductor Equipment", "Semiconductor Test", "https://www.advantest.com"),
  c("JP:TSE:6920", "JP", "TSE", "6920", "Lasertec", "Lasertec", ["Lasertec"], "Semiconductor Equipment", "Inspection", "https://www.lasertec.co.jp"),
  c("JP:TSE:6146", "JP", "TSE", "6146", "DISCO", "Disco", ["Disco"], "Semiconductor Equipment", "Dicing and Grinding", "https://www.disco.co.jp"),
  c("JP:TSE:4063", "JP", "TSE", "4063", "信越化學", "Shin-Etsu Chemical", ["Shin-Etsu"], "Chemicals", "Semiconductor Materials", "https://www.shinetsu.co.jp"),
  c("JP:TSE:3436", "JP", "TSE", "3436", "SUMCO", "SUMCO", ["SUMCO"], "Semiconductor Materials", "Silicon Wafers", "https://www.sumcosi.com"),
  c("JP:TSE:6954", "JP", "TSE", "6954", "發那科", "FANUC", ["Fanuc"], "Industrial Machinery", "Industrial Robots", "https://www.fanuc.co.jp"),
  c("JP:TSE:6861", "JP", "TSE", "6861", "基恩斯", "Keyence", ["Keyence"], "Electronic Equipment", "Factory Automation and Machine Vision", "https://www.keyence.com"),
  c("JP:TSE:6501", "JP", "TSE", "6501", "日立", "Hitachi", ["Hitachi"], "Industrial Conglomerates", "Grid and Digital Systems", "https://www.hitachi.com"),
  c("JP:TSE:6503", "JP", "TSE", "6503", "三菱電機", "Mitsubishi Electric", ["Mitsubishi Electric"], "Electrical Equipment", "Factory Automation and Power", "https://www.mitsubishielectric.com"),
  c("JP:TSE:7011", "JP", "TSE", "7011", "三菱重工", "Mitsubishi Heavy Industries", ["MHI"], "Aerospace and Defense", "Defense and Energy", "https://www.mhi.com"),
  c("JP:TSE:7012", "JP", "TSE", "7012", "川崎重工", "Kawasaki Heavy Industries", ["KHI"], "Aerospace and Defense", "Defense and Robotics", "https://global.kawasaki.com"),
  c("JP:TSE:7013", "JP", "TSE", "7013", "IHI", "IHI Corporation", ["IHI"], "Aerospace and Defense", "Aero Engines and Defense", "https://www.ihi.co.jp"),

  c("KR:KRX:005930", "KR", "KRX", "005930", "三星電子", "Samsung Electronics", ["Samsung"], "Semiconductors and Electronics", "Memory, Foundry and Devices", "https://www.samsung.com"),
  c("KR:KRX:000660", "KR", "KRX", "000660", "SK海力士", "SK hynix", ["SK Hynix"], "Semiconductors", "Memory and HBM", "https://www.skhynix.com"),
  c("KR:KRX:042700", "KR", "KRX", "042700", "Hanmi Semiconductor", "Hanmi Semiconductor", ["Hanmi"], "Semiconductor Equipment", "Advanced Packaging Equipment", "https://www.hanmisemi.com"),
  c("KR:KRX:373220", "KR", "KRX", "373220", "LG新能源", "LG Energy Solution", ["LGES"], "Batteries", "EV Batteries", "https://www.lgensol.com"),
  c("KR:KRX:006400", "KR", "KRX", "006400", "三星SDI", "Samsung SDI", ["Samsung SDI"], "Batteries", "EV Batteries and Energy Storage", "https://www.samsungsdi.com"),
  c("KR:KRX:051910", "KR", "KRX", "051910", "LG化學", "LG Chem", ["LG Chem"], "Chemicals", "Battery Materials and Chemicals", "https://www.lgchem.com"),
  c("KR:KRX:012450", "KR", "KRX", "012450", "韓華航太", "Hanwha Aerospace", ["Hanwha Aerospace"], "Aerospace and Defense", "Defense and Space", "https://www.hanwhaaerospace.com"),
];

const m = (company_id: string, theme_id: string, role: string, relevance_score: number, evidence_level: SeedMembership["evidence_level"] = "official"): SeedMembership => ({ company_id, theme_id, role, relevance_score, evidence_level });

export const CORE_MEMBERSHIPS: SeedMembership[] = [
  m("US:NASDAQ:NVDA", "semiconductor.design", "核心IC設計", 100),
  m("US:NASDAQ:NVDA", "ai.accelerator", "AI GPU平台龍頭", 100),
  m("US:NASDAQ:NVDA", "ai.server", "核心運算平台", 100),
  m("US:NASDAQ:NVDA", "datacenter.network", "高速網路平台", 95),
  m("US:NASDAQ:AMD", "semiconductor.design", "核心IC設計", 100),
  m("US:NASDAQ:AMD", "ai.accelerator", "AI加速器供應商", 95),
  m("US:NASDAQ:AMD", "ai.server", "CPU與GPU平台", 95),
  m("US:NASDAQ:AVGO", "semiconductor.design", "網通與ASIC核心", 100),
  m("US:NASDAQ:AVGO", "datacenter.network", "交換器與網路晶片", 100),
  m("US:NASDAQ:AVGO", "network.optical", "光通訊與ASIC平台", 85),
  m("US:NASDAQ:INTC", "semiconductor.design", "CPU與加速器", 95),
  m("US:NASDAQ:INTC", "semiconductor.foundry", "晶圓代工", 90),
  m("US:NASDAQ:QCOM", "semiconductor.design", "行動與邊緣晶片", 100),
  m("US:NASDAQ:QCOM", "ai.edge", "邊緣AI平台", 95),
  m("US:NASDAQ:MU", "semiconductor.memory", "記憶體核心", 100),
  m("US:NASDAQ:MU", "semiconductor.hbm", "HBM供應商", 95),
  m("US:NASDAQ:AMAT", "semiconductor.equipment", "前段設備龍頭", 100),
  m("US:NASDAQ:LRCX", "semiconductor.equipment", "蝕刻與沉積設備", 100),
  m("US:NASDAQ:KLAC", "semiconductor.equipment", "製程控制設備", 100),
  m("NL:NASDAQ:ASML", "semiconductor.equipment", "微影設備核心", 100),
  m("US:NASDAQ:MSFT", "ai.cloud", "CSP與AI雲端", 100),
  m("US:NASDAQ:MSFT", "ai.software", "企業AI平台", 100),
  m("US:NASDAQ:GOOGL", "ai.cloud", "CSP與AI雲端", 100),
  m("US:NASDAQ:GOOGL", "ai.accelerator", "自研AI加速器", 85),
  m("US:NASDAQ:AMZN", "ai.cloud", "AWS雲端", 100),
  m("US:NASDAQ:AMZN", "ai.accelerator", "自研AI晶片", 85),
  m("US:NASDAQ:META", "ai.cloud", "大型AI基礎建設買方", 95),
  m("US:NYSE:ORCL", "ai.cloud", "雲端基礎設施", 90),
  m("US:NYSE:DELL", "ai.server", "AI伺服器品牌與整合", 100),
  m("US:NYSE:HPE", "ai.server", "企業AI伺服器與網路", 95),
  m("US:NASDAQ:SMCI", "ai.server", "AI伺服器整合", 100),
  m("US:NYSE:ANET", "datacenter.network", "資料中心交換器", 100),
  m("US:NYSE:VRT", "datacenter.power", "資料中心電力基礎設施", 100),
  m("US:NYSE:VRT", "datacenter.cooling", "資料中心熱管理", 100),
  m("US:NASDAQ:AAPL", "consumer.apple", "品牌與平台核心", 100),
  m("US:NASDAQ:TSLA", "vehicle.ev", "電動車品牌與製造", 100),
  m("US:NASDAQ:TSLA", "energy.storage", "儲能系統", 90),
  m("US:NASDAQ:TSLA", "automation.humanoid", "人形機器人平台", 80),
  m("US:NYSE:ETN", "energy.grid", "電力管理與重電", 95),
  m("US:NYSE:GEV", "energy.grid", "電網設備與發電", 100),

  m("JP:TSE:8035", "semiconductor.equipment", "前段設備龍頭", 100),
  m("JP:TSE:6857", "semiconductor.equipment", "半導體測試設備", 100),
  m("JP:TSE:6920", "semiconductor.equipment", "光罩與晶圓檢測", 100),
  m("JP:TSE:6146", "semiconductor.equipment", "切割研磨設備", 100),
  m("JP:TSE:4063", "semiconductor.materials", "矽晶圓與電子材料", 100),
  m("JP:TSE:3436", "semiconductor.materials", "矽晶圓", 100),
  m("JP:TSE:6954", "automation.robot", "工業機器人龍頭", 100),
  m("JP:TSE:6954", "automation.motion", "伺服與控制", 95),
  m("JP:TSE:6861", "automation.machine_vision", "機器視覺與感測", 100),
  m("JP:TSE:6501", "energy.grid", "電網與數位基礎設施", 90),
  m("JP:TSE:6503", "automation.motion", "工廠自動化", 95),
  m("JP:TSE:6503", "energy.grid", "電力設備", 90),
  m("JP:TSE:7011", "aerospace.defense", "國防與航太核心", 100),
  m("JP:TSE:7012", "aerospace.defense", "國防與航太", 95),
  m("JP:TSE:7012", "automation.robot", "工業機器人", 80),
  m("JP:TSE:7013", "aerospace.defense", "航太引擎與國防", 100),

  m("KR:KRX:005930", "semiconductor.memory", "記憶體核心", 100),
  m("KR:KRX:005930", "semiconductor.foundry", "晶圓代工", 95),
  m("KR:KRX:005930", "semiconductor.hbm", "HBM供應商", 90),
  m("KR:KRX:000660", "semiconductor.memory", "記憶體核心", 100),
  m("KR:KRX:000660", "semiconductor.hbm", "HBM核心供應商", 100),
  m("KR:KRX:042700", "semiconductor.advanced_packaging", "先進封裝設備", 95),
  m("KR:KRX:042700", "semiconductor.equipment", "封裝設備", 95),
  m("KR:KRX:373220", "vehicle.battery", "電動車電池核心", 100),
  m("KR:KRX:006400", "vehicle.battery", "電池與儲能", 100),
  m("KR:KRX:006400", "energy.storage", "儲能電池", 90),
  m("KR:KRX:051910", "vehicle.battery_material", "電池材料", 95),
  m("KR:KRX:012450", "aerospace.defense", "國防與航太核心", 100),
  m("KR:KRX:012450", "aerospace.space", "太空與衛星", 90),
];

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type SourceGroup = "political_macro" | "technology";
type SourcePriority = "P0" | "P1";
type SourcePlatform = "x" | "truth_social" | "official_site" | "official_company";

type FirstPartySource = {
  source_id: string;
  platform: SourcePlatform;
  tier: "P0_PERSONAL_OFFICIAL" | "P0_INSTITUTIONAL_OFFICIAL" | "P1_OFFICIAL_PRIMARY";
  handle?: string;
  url: string;
  role: string;
};

type FirstPartyEntity = {
  id: string;
  display_name: string;
  group: SourceGroup;
  organization: string;
  priority: SourcePriority;
  topics: string[];
  sources: FirstPartySource[];
};

export const FIRST_PARTY_INTELLIGENCE_REGISTRY = {
  schema: "FIRST_PARTY_INTELLIGENCE_REGISTRY_V1",
  registry_version: "first-party-intelligence/v1.0.0",
  mode: "ON_DEMAND_ONLY",
  read_only: true,
  monitoring_enabled: false,
  persistence_enabled: false,
  validated_at: "2026-09-03",
  policy: {
    purpose: "Return pinned first-party routing metadata for user-initiated intelligence lookup.",
    default_evidence_order: ["P0_PERSONAL_OFFICIAL", "P0_INSTITUTIONAL_OFFICIAL", "P1_OFFICIAL_PRIMARY"],
    no_automatic_collection: true,
    no_background_activity: true,
    no_trading_action: true,
    no_ohlc_mutation: true,
    identity_rule: "Treat the registry as a routing allowlist; re-check live account identity when a source is used for a market-sensitive claim.",
  },
  entities: [
    {
      id: "donald_trump",
      display_name: "Donald J. Trump",
      group: "political_macro",
      organization: "United States Presidency",
      priority: "P0",
      topics: ["tariff", "trade", "china", "taiwan", "semiconductor", "export_control", "energy", "geopolitics"],
      sources: [
        { source_id: "donald_trump_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "realDonaldTrump", url: "https://x.com/realDonaldTrump", role: "personal official X account" },
        { source_id: "donald_trump_truth_social", platform: "truth_social", tier: "P0_PERSONAL_OFFICIAL", handle: "realDonaldTrump", url: "https://truthsocial.com/@realDonaldTrump", role: "personal official Truth Social account" },
        { source_id: "white_house", platform: "official_site", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://www.whitehouse.gov/", role: "official U.S. presidential institution source" },
      ],
    },
    {
      id: "jensen_huang",
      display_name: "Jensen Huang",
      group: "technology",
      organization: "NVIDIA",
      priority: "P0",
      topics: ["ai", "gpu", "blackwell", "rubin", "data_center", "networking", "cpo", "robotics"],
      sources: [
        { source_id: "jensen_huang_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "JensenHuang", url: "https://x.com/JensenHuang", role: "Founder and CEO personal X account" },
        { source_id: "nvidia_newsroom", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://nvidianews.nvidia.com/", role: "NVIDIA official newsroom" },
      ],
    },
    {
      id: "lisa_su",
      display_name: "Lisa Su",
      group: "technology",
      organization: "AMD",
      priority: "P0",
      topics: ["ai", "gpu", "cpu", "accelerator", "data_center", "open_software"],
      sources: [
        { source_id: "lisa_su_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "LisaSu", url: "https://x.com/LisaSu", role: "Chair and CEO personal X account" },
        { source_id: "amd_newsroom", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://www.amd.com/en/newsroom.html", role: "AMD official newsroom" },
      ],
    },
    {
      id: "sam_altman",
      display_name: "Sam Altman",
      group: "technology",
      organization: "OpenAI",
      priority: "P0",
      topics: ["ai", "models", "compute", "data_center", "agents", "infrastructure"],
      sources: [
        { source_id: "sam_altman_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "sama", url: "https://x.com/sama", role: "OpenAI CEO personal X account" },
        { source_id: "openai_news", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://openai.com/news/", role: "OpenAI official news source" },
      ],
    },
    {
      id: "satya_nadella",
      display_name: "Satya Nadella",
      group: "technology",
      organization: "Microsoft",
      priority: "P0",
      topics: ["ai", "azure", "cloud", "agents", "data_center", "capex"],
      sources: [
        { source_id: "satya_nadella_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "satyanadella", url: "https://x.com/satyanadella", role: "Chairman and CEO personal X account" },
        { source_id: "microsoft_source", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://news.microsoft.com/source/", role: "Microsoft official news source" },
      ],
    },
    {
      id: "sundar_pichai",
      display_name: "Sundar Pichai",
      group: "technology",
      organization: "Google / Alphabet",
      priority: "P0",
      topics: ["ai", "gemini", "cloud", "search", "data_center", "infrastructure"],
      sources: [
        { source_id: "sundar_pichai_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "sundarpichai", url: "https://x.com/sundarpichai", role: "Google and Alphabet CEO personal X account" },
        { source_id: "google_blog", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://blog.google/", role: "Google official company blog" },
      ],
    },
    {
      id: "demis_hassabis",
      display_name: "Demis Hassabis",
      group: "technology",
      organization: "Google DeepMind",
      priority: "P0",
      topics: ["ai", "agi", "gemini", "research", "agents", "science"],
      sources: [
        { source_id: "demis_hassabis_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "demishassabis", url: "https://x.com/demishassabis", role: "Google DeepMind CEO personal X account" },
        { source_id: "deepmind_news", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://deepmind.google/discover/blog/", role: "Google DeepMind official blog" },
      ],
    },
    {
      id: "elon_musk",
      display_name: "Elon Musk",
      group: "technology",
      organization: "xAI / Tesla / SpaceX / X",
      priority: "P0",
      topics: ["ai", "xai", "robotics", "tesla", "spacex", "compute", "data_center"],
      sources: [
        { source_id: "elon_musk_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "elonmusk", url: "https://x.com/elonmusk", role: "personal X account" },
        { source_id: "xai_news", platform: "official_company", tier: "P1_OFFICIAL_PRIMARY", url: "https://x.ai/news", role: "xAI official news source" },
      ],
    },
    {
      id: "michael_dell",
      display_name: "Michael Dell",
      group: "technology",
      organization: "Dell Technologies",
      priority: "P0",
      topics: ["ai_server", "enterprise_it", "data_center", "infrastructure", "storage"],
      sources: [
        { source_id: "michael_dell_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "MichaelDell", url: "https://x.com/MichaelDell", role: "Founder and CEO personal X account" },
        { source_id: "dell_newsroom", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://www.dell.com/en-us/dt/corporate/newsroom.htm", role: "Dell Technologies official newsroom" },
      ],
    },
    {
      id: "tim_cook",
      display_name: "Tim Cook",
      group: "technology",
      organization: "Apple",
      priority: "P0",
      topics: ["apple", "ai", "devices", "silicon", "supply_chain"],
      sources: [
        { source_id: "tim_cook_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "tim_cook", url: "https://x.com/tim_cook", role: "Apple CEO personal X account" },
        { source_id: "apple_newsroom", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://www.apple.com/newsroom/", role: "Apple official newsroom" },
      ],
    },
    {
      id: "mark_zuckerberg",
      display_name: "Mark Zuckerberg",
      group: "technology",
      organization: "Meta",
      priority: "P1",
      topics: ["ai", "llama", "vr", "ar", "data_center", "open_models"],
      sources: [
        { source_id: "mark_zuckerberg_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "finkd", url: "https://x.com/finkd", role: "Meta founder and CEO personal X account" },
        { source_id: "meta_newsroom", platform: "official_company", tier: "P0_INSTITUTIONAL_OFFICIAL", url: "https://about.fb.com/news/", role: "Meta official newsroom" },
      ],
    },
    {
      id: "jeff_bezos",
      display_name: "Jeff Bezos",
      group: "technology",
      organization: "Amazon / Blue Origin",
      priority: "P1",
      topics: ["amazon", "cloud", "space", "ai", "infrastructure"],
      sources: [
        { source_id: "jeff_bezos_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "JeffBezos", url: "https://x.com/JeffBezos", role: "Amazon founder personal X account" },
        { source_id: "amazon_news", platform: "official_company", tier: "P1_OFFICIAL_PRIMARY", url: "https://www.aboutamazon.com/news", role: "Amazon official news source" },
      ],
    },
    {
      id: "marc_benioff",
      display_name: "Marc Benioff",
      group: "technology",
      organization: "Salesforce",
      priority: "P1",
      topics: ["agents", "enterprise_ai", "crm", "cloud", "software"],
      sources: [
        { source_id: "marc_benioff_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "Benioff", url: "https://x.com/Benioff", role: "Salesforce CEO personal X account" },
        { source_id: "salesforce_news", platform: "official_company", tier: "P1_OFFICIAL_PRIMARY", url: "https://www.salesforce.com/news/", role: "Salesforce official news source" },
      ],
    },
    {
      id: "thomas_kurian",
      display_name: "Thomas Kurian",
      group: "technology",
      organization: "Google Cloud",
      priority: "P1",
      topics: ["cloud", "ai", "agents", "data_center", "enterprise_ai"],
      sources: [
        { source_id: "thomas_kurian_x", platform: "x", tier: "P0_PERSONAL_OFFICIAL", handle: "ThomasOrTK", url: "https://x.com/ThomasOrTK", role: "Google Cloud CEO personal X account" },
        { source_id: "google_cloud_blog", platform: "official_company", tier: "P1_OFFICIAL_PRIMARY", url: "https://cloud.google.com/blog", role: "Google Cloud official blog" },
      ],
    },
  ] satisfies FirstPartyEntity[],
} as const;

export function queryFirstPartyIntelligenceSources(input: {
  group?: SourceGroup;
  entity_id?: string;
  topic?: string;
  priority?: SourcePriority;
}) {
  const entityId = input.entity_id?.trim().toLowerCase();
  const topic = input.topic?.trim().toLowerCase();
  const entities = FIRST_PARTY_INTELLIGENCE_REGISTRY.entities.filter((entity) => {
    if (input.group && entity.group !== input.group) return false;
    if (entityId && entity.id !== entityId) return false;
    if (input.priority && entity.priority !== input.priority) return false;
    if (topic && !entity.topics.some((item) => item.toLowerCase() === topic)) return false;
    return true;
  });

  return {
    schema: FIRST_PARTY_INTELLIGENCE_REGISTRY.schema,
    registry_version: FIRST_PARTY_INTELLIGENCE_REGISTRY.registry_version,
    mode: FIRST_PARTY_INTELLIGENCE_REGISTRY.mode,
    read_only: FIRST_PARTY_INTELLIGENCE_REGISTRY.read_only,
    monitoring_enabled: FIRST_PARTY_INTELLIGENCE_REGISTRY.monitoring_enabled,
    persistence_enabled: FIRST_PARTY_INTELLIGENCE_REGISTRY.persistence_enabled,
    validated_at: FIRST_PARTY_INTELLIGENCE_REGISTRY.validated_at,
    policy: FIRST_PARTY_INTELLIGENCE_REGISTRY.policy,
    filters: input,
    count: entities.length,
    entities,
  };
}

export function registerFirstPartyIntelligenceSourceResource(server: McpServer) {
  server.registerResource(
    "first_party_intelligence_registry",
    "first-party-intelligence://registry",
    {
      title: "First-Party Intelligence Source Registry",
      description: "Read-only, on-demand routing allowlist for Trump/political-macro and technology-leader first-party sources. No monitoring, persistence, trading, or OHLC mutation.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(FIRST_PARTY_INTELLIGENCE_REGISTRY, null, 2),
      }],
    }),
  );
}

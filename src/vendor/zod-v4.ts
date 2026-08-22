// Canonical Zod entry for the Cloudflare Worker bundle.
// Bare `zod` imports are mapped here through tsconfig.paths while MCP SDK keeps
// its native `zod/v4` import. Both paths therefore resolve to the same public
// Zod v4 implementation without reaching into private v4/core internals.
export * from "zod/v4";

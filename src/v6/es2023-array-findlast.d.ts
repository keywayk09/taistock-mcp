// Runtime targets (Cloudflare Workers / Node 22 CI) support Array.prototype.findLastIndex.
// The project intentionally keeps tsconfig lib=es2022, so declare only the single ES2023 method P14 uses.
interface Array<T> {
  findLastIndex(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown): number;
}

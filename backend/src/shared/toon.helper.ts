/**
 * Lazy ESM loader for @toon-format/toon.
 *
 * The package ships as ESM-only (.mjs), which cannot be require()'d from a
 * CommonJS NestJS process. We use a dynamic import() — valid in any Node
 * module mode — and cache the result so the module is only loaded once.
 */

let _encode: ((data: unknown) => string) | null = null;

export async function toonEncode(data: unknown): Promise<string> {
  if (!_encode) {
    const mod = await import('@toon-format/toon');
    _encode = mod.encode as (data: unknown) => string;
  }
  return _encode(data);
}

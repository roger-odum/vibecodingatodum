/**
 * Gewone functies, zonder MCP of Worker eromheen, zodat je ze test als
 * gewone code. Zie test/index.test.ts.
 */
export function greet(name: string): string {
  return `Hallo ${name} — dit draait op Cloudflare Workers.`;
}

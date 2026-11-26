import { describe, expect, it } from "vitest";
import { greet, handleMcp } from "../src/index";

describe("greet", () => {
  it("noemt de naam die je meegeeft", () => {
    expect(greet("Odum")).toContain("Odum");
  });
});

async function rpc(method: string, params: unknown = {}) {
  const res = await handleMcp(
    new Request("https://test.local/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

describe("MCP-endpoint", () => {
  it("antwoordt op initialize", async () => {
    const r = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(r.result.serverInfo.name).toBe("odum-lab-mcp");
  });

  it("toont de tools", async () => {
    const r = await rpc("tools/list");
    const namen = r.result.tools.map((t: { name: string }) => t.name);
    expect(namen).toEqual(expect.arrayContaining(["zeg_hallo", "huidige_tijd"]));
  });

  it("voert zeg_hallo uit", async () => {
    const r = await rpc("tools/call", { name: "zeg_hallo", arguments: { naam: "Odum" } });
    expect(r.result.content[0].text).toContain("Odum");
  });

  it("geeft een nette fout bij een onbekende tijdzone", async () => {
    const r = await rpc("tools/call", {
      name: "huidige_tijd",
      arguments: { tijdzone: "Nergens/Niets" },
    });
    expect(r.result.isError).toBe(true);
  });
});

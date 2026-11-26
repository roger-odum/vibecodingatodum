import { describe, expect, it } from "vitest";
import { greet } from "../src/index";

describe("greet", () => {
  it("noemt de naam die je meegeeft", () => {
    expect(greet("Odum")).toContain("Odum");
  });
});

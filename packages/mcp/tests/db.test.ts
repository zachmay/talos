import { describe, it, expect } from "vitest";

// db.ts requires DATABASE_URL; set a dummy so module loads
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/talos_test";

const dbModule = await import("../src/db.js").catch(() => null);

describe("DB wrapper", () => {
  it("module loads and exports pool and withAgent", () => {
    expect(dbModule).not.toBeNull();
    expect(dbModule!.pool).toBeDefined();
    expect(dbModule!.withAgent).toBeDefined();
  });

  it("withAgent is a function", () => {
    expect(typeof dbModule!.withAgent).toBe("function");
  });
});

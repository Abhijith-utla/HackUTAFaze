import { describe, expect, it } from "vitest";
import { databaseUrlFor } from "../src/database-config.js";
describe("database target isolation", () => {
  it("requires explicit test database without falling back to the app", () => {
    expect(() => databaseUrlFor({ DATABASE_URL: "postgres://x@localhost/app" }, true)).toThrow(/TEST_DATABASE_URL/);
    expect(() => databaseUrlFor({ DATABASE_URL: "postgres://x@localhost/app", TEST_DATABASE_URL: "postgresql://y@localhost:5432/app" }, true)).toThrow(/separate/);
  });
  it("requires TLS for remote Tiger Cloud and permits local test fixtures", () => {
    expect(() => databaseUrlFor({ DATABASE_URL: "postgres://x@cloud.example/db" }, false)).toThrow(/sslmode/);
    expect(databaseUrlFor({ DATABASE_URL: "postgres://x@cloud.example/db?sslmode=require" }, false)).toContain("sslmode=require");
    expect(databaseUrlFor({ TEST_DATABASE_URL: "postgres://x@localhost/faze_test" }, true)).toContain("faze_test");
  });
});


// Supply TEST_DATABASE_URL for this dedicated unit-only configuration; no database connection is made.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/database-config.test.ts", "test/art.test.ts"] } });

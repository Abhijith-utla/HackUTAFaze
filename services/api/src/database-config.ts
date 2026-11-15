/** Keep tests off the application database and require TLS for remote services. */
export function databaseUrlFor(env: NodeJS.ProcessEnv, isTest: boolean): string {
  const raw = isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  if (!raw) throw new Error(`Missing ${isTest ? "TEST_DATABASE_URL (dedicated test database)" : "DATABASE_URL"}`);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid database connection URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Database must use a PostgreSQL connection URL");
  if (isTest && env.DATABASE_URL) {
    const app = new URL(env.DATABASE_URL);
    if (app.hostname === url.hostname && (app.port || "5432") === (url.port || "5432") && app.pathname === url.pathname) {
      throw new Error("TEST_DATABASE_URL must identify a separate database from DATABASE_URL");
    }
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") || "")) {
    throw new Error("Remote Tiger Cloud connections require sslmode=require, verify-ca or verify-full");
  }
  return raw;
}

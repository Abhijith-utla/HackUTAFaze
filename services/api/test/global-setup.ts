// Needs Postgres at DATABASE_URL (default: docker compose up -d db). Applies migrations once.
export default async function setup() {
  process.env.VITEST = "1";
  const { migrate } = await import("../src/migrate.js");
  const { pool } = await import("../src/db.js");
  await migrate();
  await pool.end();
}

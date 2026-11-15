// Same-origin proxy so the httpOnly session cookie works without CORS.
const API = process.env.API_URL ?? "http://localhost:4000";
const PAYMENTS = process.env.PAYMENTS_URL ?? "http://localhost:4100";

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@faze/shared"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/:path*` },
      { source: "/pay/:path*", destination: `${PAYMENTS}/payments/:path*` },
    ];
  },
};

import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "FaZe Control Room",
  description:
    "Staff card publishing, moderation and simulated engagement tools.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

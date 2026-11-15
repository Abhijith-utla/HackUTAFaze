// Staff area of the FaZe app: the staff console at /admin and the Control Room at /admin/control.
// Styles are scoped under .admin-root so nothing leaks into the fan pages (and vice versa).
import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: "FaZe Control Room",
  description: "Staff card publishing, moderation, KAM intelligence and campaign operations.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-root">{children}</div>;
}

import type { Metadata } from "next";
import "./control.css";
import { Shell } from "./_components/ui";

export const metadata: Metadata = { title: "FaZe Control Room · Business Operations" };

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

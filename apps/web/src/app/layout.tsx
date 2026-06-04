import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Visual HPC for Engineers — Why Parallel Code Gets Slower",
  description:
    "An interactive performance laboratory: flip the fix and watch the hardware react. Model and real measured 24-core scaling.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Nav />{children}</body>
    </html>
  );
}

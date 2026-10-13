import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: brand.name,
  description: `${brand.name} local video editing workspace.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

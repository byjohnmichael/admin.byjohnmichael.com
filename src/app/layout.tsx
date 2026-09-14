import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "Admin",
  description: "Private admin dashboard for byjohnmichael.com services.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <Header />
        <main className="flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}

// byjohnmichael*

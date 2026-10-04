import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import FloatingBob from "@/components/FloatingBob";
import Backdrop from "@/components/Backdrop";
import IdleLock from "@/components/IdleLock";
import TerminalHost from "@/components/terminal/TerminalHost";

// One monospace face for the whole panel — the terminal look starts here.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Admin",
  description: "Private admin dashboard for byjohnmichael.com services.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Backdrop />
        <Header />
        <main className="flex-1 px-4 py-8 sm:px-6">{children}
          <TerminalHost />
        </main>
        <FloatingBob />
        <IdleLock />
      </body>
    </html>
  );
}

// byjohnmichael*

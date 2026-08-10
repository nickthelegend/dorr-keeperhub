import type React from "react";
import { Roboto_Mono } from "next/font/google";
import "./globals.css";
import type { Metadata } from "next";
import { V0Provider } from "@/lib/context";
import localFont from "next/font/local";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

const rebelGrotesk = localFont({
  src: "../public/fonts/Rebels-Fett.woff2",
  variable: "--font-rebels",
  display: "swap",
});

const isV0 = process.env["VERCEL_URL"]?.includes("vusercontent.net") ?? false;

export const metadata: Metadata = {
  title: {
    template: "%s – MEV Shield",
    default: "MEV Shield — the private lane, measured",
  },
  description:
    "The same swap run twice on Ethereum Sepolia — public mempool versus KeeperHub private routing — with the sandwich loss priced in dollars.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes writes `style="color-scheme:…"` onto <html> from a blocking
    // script before React hydrates, so the server markup and the client DOM
    // legitimately differ by that one attribute. Without this, every page load
    // logs "Extra attributes from the server: style" — a console error on a
    // clean run, which makes real errors harder to notice.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/Rebels-Fett.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${rebelGrotesk.variable} ${robotoMono.variable} antialiased`}
      >
        <V0Provider isV0={isV0}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>
                <div className="min-h-screen bg-background">{children}</div>
                <Toaster />
            </QueryProvider>
          </ThemeProvider>
        </V0Provider>
      </body>
    </html>
  );
}

import type React from "react";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import type { Metadata } from "next";
import { V0Provider } from "@/lib/context";
import localFont from "next/font/local";
import { QueryProvider } from "@/components/providers/query-provider";
import { MarketProvider } from "@/context/market-context";
import { Toaster } from "@/components/ui/sonner";
import { WalletProvider } from "@/components/providers/wallet-provider";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Inter, for the marketing surface only.
 *
 * The terminal is deliberately monospaced — it is a trading screen and the
 * columns have to align. A landing page wants the opposite, so the variable is
 * exposed here and applied by the landing route alone. Nothing about the
 * product's typography changes.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

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

/**
 * Where relative asset URLs in metadata resolve from.
 *
 * Without it Next warns at build time and falls back to `localhost:3000`, so a
 * shared link renders its Open Graph image against an address only the author's
 * machine can reach. `NEXT_PUBLIC_SITE_URL` when deployed, Vercel's own host
 * when it supplies one, and localhost as the last resort.
 */
const siteUrl =
  process.env["NEXT_PUBLIC_SITE_URL"] ??
  (process.env["VERCEL_URL"] ? `https://${process.env["VERCEL_URL"]}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    // The template already supplies the product name, so page titles must not
    // repeat it — "dorr · MEV Shield – dorr" is what happens when they do.
    template: "dorr · %s",
    default: "dorr — private trading on Sepolia",
  },
  description:
    "Private trading on Ethereum Sepolia. MEV Shield prices what the public mempool costs you, in dollars, with transaction hashes. The perps are the venue that never puts you in it — sealed orders, hidden stops, and PnL settled on chain by KeeperHub rather than on our word.",
  openGraph: {
    type: "website",
    siteName: "dorr",
    url: siteUrl,
  },
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
        className={`${rebelGrotesk.variable} ${robotoMono.variable} antialiased ${inter.variable}`}
      >
        <V0Provider isV0={isV0}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>
              <WalletProvider>
              <MarketProvider>
                <div className="min-h-screen bg-background">{children}</div>
                <Toaster />
              </MarketProvider>
              </WalletProvider>
            </QueryProvider>
          </ThemeProvider>
        </V0Provider>
      </body>
    </html>
  );
}

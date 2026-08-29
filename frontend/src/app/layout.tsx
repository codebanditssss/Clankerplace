import type { Metadata } from "next";
import { Manrope, JetBrains_Mono, Rubik_Mono_One } from "next/font/google";
import { FUELBORN_BRAND } from "@/lib/brand";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Numerals only — exposed as --font-numeric. Applied via the `.num` utility
// (see globals.css) on integer/number-only spans so chunky digits sit
// alongside JetBrains Mono text without touching letters.
const rubikMono = Rubik_Mono_One({
  variable: "--font-numeric",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const shareImage = {
  url: "/screenshot.png",
  width: 1528,
  height: 772,
  alt: "FuelBorn dashboard preview",
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.FUELBORN_PUBLIC_URL ??
      process.env.PODS_PUBLIC_URL ??
      FUELBORN_BRAND.defaultOrigin,
  ),
  title: FUELBORN_BRAND.name,
  description: FUELBORN_BRAND.tagline,
  icons: {
    icon: [
      { url: "/pods_favicon_tight_512.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: ["/pods_favicon_tight_512.png"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: FUELBORN_BRAND.name,
    description: FUELBORN_BRAND.tagline,
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: FUELBORN_BRAND.name,
    description: FUELBORN_BRAND.tagline,
    images: [shareImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${jetbrainsMono.variable} ${rubikMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}

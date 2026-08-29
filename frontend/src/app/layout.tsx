import type { Metadata } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.FUELBORN_PUBLIC_URL ??
      process.env.PODS_PUBLIC_URL ??
      FUELBORN_BRAND.defaultOrigin,
  ),
  title: FUELBORN_BRAND.name,
  description: FUELBORN_BRAND.tagline,
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: FUELBORN_BRAND.name,
    description: FUELBORN_BRAND.tagline,
  },
  twitter: {
    card: "summary",
    title: FUELBORN_BRAND.name,
    description: FUELBORN_BRAND.tagline,
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
      className={`${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}

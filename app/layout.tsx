import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Bursa Map",
  description: "Bursa toplu taşıma ve ilgi noktaları haritası",
  applicationName: "Bursa Map",
  appleWebApp: {
    capable: true,
    title: "Bursa Map",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // Çentikli ekranlarda safe-area-inset değerlerini aktif eder
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sideline · Live Sports Tracker",
  description:
    "Your match-day companion. Follow football, basketball, and baseball scores, standings, players, and favorite teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

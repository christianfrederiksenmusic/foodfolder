import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Comfortaa } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-body" });
const comfortaa = Comfortaa({ subsets: ["latin"], variable: "--font-heading", weight: ["700"] });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fridge Scan",
  description: "Upload et foto af dit køleskab og få ingredienser udtrukket.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da">
      <body
        className={`${dmSans.variable} ${comfortaa.variable} ${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ fontFamily: "var(--font-body)" }}
      >
        {children}
      </body>
    </html>
  );
}

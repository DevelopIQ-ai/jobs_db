import type { Metadata } from "next";
import { Space_Mono, Caveat } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const caveat = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ScrappyPuffle — Find Your Early Adopters",
  description: "We read posts, activity, and local directories before showing you a single name, so outreach feels obvious, not awkward.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceMono.variable} ${caveat.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

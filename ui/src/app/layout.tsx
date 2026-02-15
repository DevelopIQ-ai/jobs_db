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
  description:
    "We scan posts, directories, and signals across the web. Then we throw away the noise.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${spaceMono.variable} ${caveat.variable} antialiased noise`}
      >
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Barlow_Condensed, Public_Sans, Roboto_Mono } from "next/font/google";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  weight: ["700"],
  subsets: ["latin"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  weight: ["400", "600"],
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  weight: ["500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aqua Messenger",
  description: "Retrofit hydrant sensors for NYC DEP: open, struck, or failing, reported in real time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${barlowCondensed.variable} ${publicSans.variable} ${robotoMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

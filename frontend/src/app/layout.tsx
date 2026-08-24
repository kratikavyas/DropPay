import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DropPay — Non-Custodial Money Drops on Stellar",
  description: "Send time-locked USDC payment links on Stellar. Recipients claim with Face ID in seconds. Unclaimed funds auto-refund.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-black">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}

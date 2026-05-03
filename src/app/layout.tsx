import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { validateEnv } from "@/lib/env-validation";

validateEnv();

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentSCAD - CAD Agent System",
  description: "Engineering control room for CAD job orchestration. Transform natural language into editable 3D models with multi-agent pipeline.",
  keywords: ["AgentSCAD", "CAD", "OpenSCAD", "3D Printing", "AI Agent", "Parametric Design"],
  authors: [{ name: "AgentSCAD Team" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "AgentSCAD - CAD Agent System",
    description: "Engineering control room for CAD job orchestration",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased cad-custom-scrollbar`}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Devanagari, Orbitron, Rajdhani, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["600", "700", "800", "900"] });
const rajdhani = Rajdhani({ variable: "--font-rajdhani", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = Share_Tech_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400"] });
const noto = Noto_Sans({ variable: "--font-noto", subsets: ["latin"], weight: ["400", "600", "700"] });
const deva = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari"], weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "NyayaSathi - Agentic AI legal aid for every Indian | Shravan Kasar",
  description:
    "Describe your problem in English, Hindi or Marathi. NyayaSathi's agents find the exact sections of Indian law, work out the right forum and deadlines, and draft a ready-to-file complaint with every citation verified.",
};

// applies the saved "Dark Ops" choice before first paint, so the page does not flash
const themeScript = `try{if(localStorage.getItem("ns-theme")==="dark")document.documentElement.classList.add("dark-theme")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${orbitron.variable} ${rajdhani.variable} ${mono.variable} ${noto.variable} ${deva.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

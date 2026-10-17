import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NyayaSathi - Free AI legal aid for every Indian | Shravan Kasar",
  description:
    "Describe your problem in English, Hindi or Marathi. NyayaSathi's agents find the exact sections of Indian law, work out the right forum and deadlines, and draft a ready-to-file complaint with every citation verified.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased" style={{ fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', 'Noto Sans Devanagari', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}

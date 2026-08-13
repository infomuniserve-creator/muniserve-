import type { Metadata } from "next";
import { Nunito, Quicksand } from "next/font/google";
import "./globals.css";

/**
 * Nunito (body/UI) + Quicksand (headings/display) replace the Geist
 * default -- picked for the staff-dashboard redesign (soft, rounded,
 * friendly-but-professional, see CLAUDE.md's design-system note) and used
 * everywhere, not just the dashboard, so the applicant-facing pages read
 * as the same product rather than switching typefaces mid-flow.
 */
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "MuniServe",
  description: "Electronic Business Permit and Licensing System — San Miguel, Bulacan",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} ${quicksand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-ink font-sans">{children}</body>
    </html>
  );
}

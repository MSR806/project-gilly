import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gilly",
  description: "Gilly management console",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <span className="app-header__brand">Gilly</span>
        </header>
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}

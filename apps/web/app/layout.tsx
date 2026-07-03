import type { Metadata, Viewport } from "next";
import Link from "next/link";
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
          <Link href="/" className="app-header__brand">
            Gilly
          </Link>
          <nav className="app-header__nav">
            <Link href="/">Agents</Link>
            <Link href="/connectors">Connectors</Link>
            <Link href="/users">Users</Link>
          </nav>
        </header>
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}

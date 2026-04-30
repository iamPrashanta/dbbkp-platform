import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "DBBKP Panel | Modern DevOps Control Plane",
  description: "Next-generation server and infrastructure management",
};

import TRPCProvider from "@/trpc/Provider";
import SessionManager from "@/components/SessionManager";
import Link from "next/link";
import { LayoutDashboard, Globe, Terminal, Shield } from "lucide-react";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TRPCProvider>
          <SessionManager />
          <div className="main-layout">
            <aside className="sidebar">
              <div className="brand">
                <Shield size={24} className="text-primary" />
                <span>DBBKP</span>
              </div>
              <nav>
                <Link href="/">
                  <LayoutDashboard size={18} />
                  <span>Pipelines</span>
                </Link>
                <Link href="/sites">
                  <Globe size={18} />
                  <span>Hosting</span>
                </Link>
              </nav>
            </aside>
            <div className="content-area">
              {children}
            </div>
          </div>
        </TRPCProvider>
      </body>
    </html>
  );
}

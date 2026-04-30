import "./globals.css";
import { Inter } from "next/font/google";
import TRPCProvider from "@/trpc/Provider";
import { AuthProvider } from "@/components/AuthProvider";
import SessionManager from "@/components/SessionManager";
import LayoutWrapper from "@/components/LayoutWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "DBBKP Panel | Modern DevOps Control Plane",
  description: "Next-generation server and infrastructure management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TRPCProvider>
          <AuthProvider>
            <SessionManager />
            <LayoutWrapper>
              {children}
            </LayoutWrapper>
          </AuthProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}

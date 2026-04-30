"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Globe, Shield, LogOut } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { logout, user } = useAuth();
  
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="main-layout">
      <aside className="sidebar">
        <div className="brand">
          <Shield size={24} className="text-primary" />
          <span>DBBKP</span>
        </div>
        <nav>
          <Link href="/" className={pathname === "/" ? "active" : ""}>
            <LayoutDashboard size={18} />
            <span>Pipelines</span>
          </Link>
          <Link href="/sites" className={pathname.startsWith("/sites") ? "active" : ""}>
            <Globe size={18} />
            <span>Hosting</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
           <div className="user-info">
              <span className="username">{user?.username || "Admin"}</span>
              <button onClick={logout} className="logout-btn" title="Logout">
                <LogOut size={16} />
              </button>
           </div>
        </div>
      </aside>
      <div className="content-area">
        {children}
      </div>
    </div>
  );
}

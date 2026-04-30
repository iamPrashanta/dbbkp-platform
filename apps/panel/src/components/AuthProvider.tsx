"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { trpc } from "@/utils/trpc";

type User = {
  id: string;
  username: string;
  email: string;
  role: string;
  mustChangePassword?: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Use the tRPC 'me' query to verify the session
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !!(typeof window !== "undefined" && localStorage.getItem("token")),
    retry: false,
    onSuccess: (data) => {
      setUser(data as any);
    },
    onError: (err) => {
      if (err.message === "PASSWORD_ROTATION_REQUIRED") {
        router.push("/setup/password");
      } else {
        handleLogout();
      }
    }
  });

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
    if (pathname !== "/login") {
      router.push("/login");
    }
  };

  useEffect(() => {
    if (!isClient) return;

    const token = localStorage.getItem("token");
    const isPublicPath = pathname === "/login";

    if (!token && !isPublicPath) {
      router.push("/login");
      return;
    }

    if (token && user) {
      // Enforce password change if flagged
      if (user.mustChangePassword && pathname !== "/setup/password") {
        router.push("/setup/password");
        return;
      }

      if (isPublicPath) {
        router.push("/");
      }
    }
  }, [pathname, isClient, user, router]);

  return (
    <AuthContext.Provider value={{ user, isLoading: meQuery.isLoading, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};

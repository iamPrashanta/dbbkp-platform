"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SessionManager() {
  const router = useRouter();

  useEffect(() => {
    let timer: NodeJS.Timeout;
    const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    const logout = () => {
      console.log("Session expired due to inactivity");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      router.push("/login");
    };

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(logout, IDLE_TIMEOUT);
    };

    // Listen for activity
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    events.forEach((name) => window.addEventListener(name, resetTimer));

    // Initial timer
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, resetTimer));
    };
  }, [router]);

  return null;
}

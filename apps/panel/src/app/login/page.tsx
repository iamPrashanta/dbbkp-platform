"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      localStorage.setItem("token", data.token);
      router.push("/");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    login.mutate({ username, password });
  };

  return (
    <main style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="glass" style={{ width: "100%", maxWidth: "400px", padding: "2.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "700", marginBottom: "0.5rem" }}>Welcome back</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "2rem" }}>Enter your credentials to access the panel</p>
        
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Username</label>
            <input 
              type="text" 
              className="input" 
              placeholder="admin" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.5rem", color: "var(--text-muted)" }}>Password</label>
            <input 
              type="password" 
              className="input" 
              placeholder="••••••••" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          {error && <div style={{ color: "var(--error)", fontSize: "0.85rem" }}>{error}</div>}
          
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ marginTop: "0.5rem", justifyContent: "center" }}
            disabled={login.isLoading}
          >
            {login.isLoading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </main>
  );
}

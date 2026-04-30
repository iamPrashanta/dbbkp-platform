"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";
import { Shield, Lock, Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

export default function PasswordSetupPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const { logout } = useAuth();

  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      // Password changed successfully, session revoked by backend
      // We must log out and re-login
      logout();
      router.push("/login?message=Password updated. Please login again.");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    changePassword.mutate({ newPassword: password });
  };

  return (
    <main className="setup-page">
      <div className="setup-card glass">
        <div className="setup-header">
          <div className="icon-box">
            <Lock size={32} className="text-warning" />
          </div>
          <h1>Security Setup</h1>
          <p>Your account was created with a temporary password. Please set a new secure password to continue.</p>
        </div>

        <div className="alert-warning">
          <AlertTriangle size={18} />
          <span>This action will sign you out of all sessions.</span>
        </div>

        <form onSubmit={handleSubmit} className="setup-form">
          <div className="form-group">
            <label>New Password</label>
            <div className="input-wrapper">
              <Lock size={18} className="input-icon" />
              <input
                type="password"
                className="input"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <div className="input-wrapper">
              <Lock size={18} className="input-icon" />
              <input
                type="password"
                className="input"
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && <div className="setup-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary setup-submit"
            disabled={changePassword.isLoading}
          >
            {changePassword.isLoading ? (
              <Loader2 className="spin" size={20} />
            ) : (
              "Update Password & Continue"
            )}
          </button>
        </form>
      </div>

      <style jsx>{`
        .setup-page {
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at center, #121418 0%, #0a0b0d 100%);
          padding: 20px;
        }

        .setup-card {
          width: 100%;
          max-width: 480px;
          padding: 3rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
        }

        .setup-header {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }

        .icon-box {
          width: 64px;
          height: 64px;
          background: rgba(245, 158, 11, 0.1);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.5rem;
        }

        .setup-header h1 {
          font-size: 1.75rem;
          font-weight: 800;
          letter-spacing: -0.03em;
        }

        .setup-header p {
          color: var(--text-muted);
          font-size: 0.95rem;
          line-height: 1.6;
        }

        .alert-warning {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          background: rgba(245, 158, 11, 0.1);
          color: var(--warning);
          border-radius: var(--radius);
          font-size: 0.85rem;
          border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .setup-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-group label {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 12px;
          color: var(--text-muted);
        }

        .input-wrapper :global(.input) {
          padding-left: 40px;
          height: 48px;
          background: rgba(0, 0, 0, 0.2);
          font-size: 1rem;
        }

        .setup-submit {
          height: 48px;
          font-size: 1rem;
          margin-top: 0.5rem;
        }

        .setup-error {
          padding: 10px;
          background: rgba(239, 68, 68, 0.1);
          color: var(--error);
          border-radius: var(--radius);
          font-size: 0.85rem;
          text-align: center;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
      `}</style>
    </main>
  );
}

"use client";

import React, { useState } from "react";
import { Globe, ArrowLeft, Upload, Github, Zap, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";

export default function CreateSitePage() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [runtime, setRuntime] = useState<"static" | "node" | "python">("static");
  const [source, setSource] = useState<"zip" | "git">("zip");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const createGitSite = trpc.sites.create.useMutation({
    onSuccess: () => {
      router.push("/sites");
    },
    onError: (err) => {
      setError(err.message);
      setLoading(false);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (source === "git") {
      createGitSite.mutate({
        domain,
        runtime,
        source: "git",
        repoUrl,
        branch,
      });
    } else {
      // ZIP Upload Flow
      if (!file) {
        setError("Please select a ZIP file");
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append("project", file);
      formData.append("domain", domain);
      formData.append("type", runtime);

      try {
        const res = await fetch("/api/sites/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }

        router.push("/sites");
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    }
  };

  return (
    <main className="panel-container narrow">
      <header className="dashboard-header">
        <div>
          <Link href="/sites" className="back-link">
            <ArrowLeft size={14} />
            Back to Sites
          </Link>
          <h1>Create Website</h1>
          <p>Configure your domain and source code.</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="create-site-form glass">
        <section className="form-section">
          <label>
            <span>Domain Name</span>
            <input 
              type="text" 
              className="input" 
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
            />
          </label>

          <div className="runtime-selector">
            <span>Runtime</span>
            <div className="radio-group">
              <button 
                type="button" 
                className={runtime === "static" ? "active" : ""} 
                onClick={() => setRuntime("static")}
              >
                Static
              </button>
              <button 
                type="button" 
                className={runtime === "node" ? "active" : ""} 
                onClick={() => setRuntime("node")}
              >
                Node.js
              </button>
              <button 
                type="button" 
                className={runtime === "python" ? "active" : ""} 
                onClick={() => setRuntime("python")}
              >
                Python
              </button>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="source-selector">
            <span>Source</span>
            <div className="source-options">
              <button 
                type="button" 
                className={`source-btn ${source === "zip" ? "active" : ""}`}
                onClick={() => setSource("zip")}
              >
                <Upload size={18} />
                <div>
                  <strong>ZIP Upload</strong>
                  <span>Fast manual deployment</span>
                </div>
              </button>
              <button 
                type="button" 
                className={`source-btn ${source === "git" ? "active" : ""}`}
                onClick={() => setSource("git")}
              >
                <Github size={18} />
                <div>
                  <strong>Git Repository</strong>
                  <span>Automatic CI/CD flow</span>
                </div>
              </button>
            </div>
          </div>

          {source === "zip" ? (
            <label className="file-upload">
              <span>Project Files (.zip)</span>
              <div className="file-dropzone">
                <input 
                  type="file" 
                  accept=".zip" 
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <Upload size={24} />
                <p>{file ? file.name : "Select or drag ZIP project"}</p>
              </div>
            </label>
          ) : (
            <div className="git-inputs">
              <label>
                <span>Repository URL</span>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="https://github.com/user/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  required={source === "git"}
                />
              </label>
              <label>
                <span>Branch</span>
                <input 
                  type="text" 
                  className="input" 
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
            </div>
          )}
        </section>

        {error && <div className="error-msg">{error}</div>}

        <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
          {loading ? <Loader2 size={18} className="spin" /> : <Zap size={18} />}
          {loading ? "Deploying..." : "Create & Deploy"}
        </button>
      </form>

      <style jsx>{`
        .narrow {
          max-width: 680px;
          margin: 0 auto;
        }
        .back-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.85rem;
          color: var(--text-muted);
          margin-bottom: 1rem;
        }
        .create-site-form {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }
        .form-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        label span, .runtime-selector > span, .source-selector > span {
          display: block;
          margin-bottom: 0.75rem;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-muted);
        }
        .radio-group {
          display: flex;
          gap: 0.5rem;
          background: #0c0e12;
          padding: 4px;
          border-radius: var(--radius);
          border: 1px solid var(--border);
        }
        .radio-group button {
          flex: 1;
          padding: 0.5rem;
          border: 0;
          background: transparent;
          color: var(--text-muted);
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
        }
        .radio-group button.active {
          background: var(--panel-soft);
          color: var(--active);
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .source-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .source-btn {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.25rem;
          background: #0c0e12;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
        }
        .source-btn.active {
          border-color: var(--active);
          background: rgba(56, 189, 248, 0.05);
        }
        .source-btn strong {
          display: block;
          font-size: 0.95rem;
        }
        .source-btn span {
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        .file-dropzone {
          position: relative;
          border: 2px dashed var(--border);
          border-radius: var(--radius);
          padding: 2rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .file-dropzone:hover {
          border-color: var(--text-muted);
        }
        .file-dropzone input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }
        .git-inputs {
          display: grid;
          grid-template-columns: 1fr 120px;
          gap: 1rem;
        }
        .btn-lg {
          width: 100%;
          min-height: 50px;
          font-size: 1.1rem;
        }
        .error-msg {
          color: var(--error);
          font-size: 0.9rem;
          text-align: center;
        }
      `}</style>
    </main>
  );
}

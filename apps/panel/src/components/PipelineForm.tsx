"use client";

import { Rocket } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/utils/trpc";

type Props = {
  onCreated: () => void;
};

export function PipelineForm({ onCreated }: Props) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [buildCommand, setBuildCommand] = useState("npm install && npm run build");
  const [deployCommand, setDeployCommand] = useState("");

  const createPipeline = trpc.pipeline.create.useMutation({
    onSuccess: () => {
      setName("");
      setRepoUrl("");
      setBranch("main");
      setBuildCommand("npm install && npm run build");
      setDeployCommand("");
      onCreated();
    },
  });

  return (
    <section className="pipeline-form">
      <div className="section-heading">
        <div>
          <h2>Create Pipeline</h2>
          <p>Docker-isolated build and deploy commands</p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          createPipeline.mutate({
            name,
            repoUrl,
            branch,
            buildCommand: buildCommand || undefined,
            deployCommand: deployCommand || undefined,
          });
        }}
      >
        <label>
          Name
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Repository URL
          <input className="input" type="url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} required />
        </label>
        <label>
          Branch
          <input className="input" value={branch} onChange={(event) => setBranch(event.target.value)} required />
        </label>
        <label>
          Build command
          <input className="input" value={buildCommand} onChange={(event) => setBuildCommand(event.target.value)} />
        </label>
        <label>
          Deploy command
          <input className="input" value={deployCommand} onChange={(event) => setDeployCommand(event.target.value)} />
        </label>
        {createPipeline.error ? <p className="form-error">{createPipeline.error.message}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={createPipeline.isLoading}>
          <Rocket size={16} />
          {createPipeline.isLoading ? "Creating..." : "Create"}
        </button>
      </form>
    </section>
  );
}

"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineForm = PipelineForm;
const lucide_react_1 = require("lucide-react");
const react_1 = require("react");
const trpc_1 = require("@/utils/trpc");
function PipelineForm({ onCreated }) {
    const [name, setName] = (0, react_1.useState)("");
    const [repoUrl, setRepoUrl] = (0, react_1.useState)("");
    const [branch, setBranch] = (0, react_1.useState)("main");
    const [buildCommand, setBuildCommand] = (0, react_1.useState)("npm install && npm run build");
    const [deployCommand, setDeployCommand] = (0, react_1.useState)("");
    const createPipeline = trpc_1.trpc.pipeline.create.useMutation({
        onSuccess: () => {
            setName("");
            setRepoUrl("");
            setBranch("main");
            setBuildCommand("npm install && npm run build");
            setDeployCommand("");
            onCreated();
        },
    });
    return (<section className="pipeline-form">
      <div className="section-heading">
        <div>
          <h2>Create Pipeline</h2>
          <p>Docker-isolated build and deploy commands</p>
        </div>
      </div>
      <form onSubmit={(event) => {
            event.preventDefault();
            createPipeline.mutate({
                name,
                repoUrl,
                branch,
                buildCommand: buildCommand || undefined,
                deployCommand: deployCommand || undefined,
            });
        }}>
        <label>
          Name
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} required/>
        </label>
        <label>
          Repository URL
          <input className="input" type="url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} required/>
        </label>
        <label>
          Branch
          <input className="input" value={branch} onChange={(event) => setBranch(event.target.value)} required/>
        </label>
        <label>
          Build command
          <input className="input" value={buildCommand} onChange={(event) => setBuildCommand(event.target.value)}/>
        </label>
        <label>
          Deploy command
          <input className="input" value={deployCommand} onChange={(event) => setDeployCommand(event.target.value)}/>
        </label>
        {createPipeline.error ? <p className="form-error">{createPipeline.error.message}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={createPipeline.isLoading}>
          <lucide_react_1.Rocket size={16}/>
          {createPipeline.isLoading ? "Creating..." : "Create"}
        </button>
      </form>
    </section>);
}

"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalLogViewer = TerminalLogViewer;
const lucide_react_1 = require("lucide-react");
const react_1 = require("react");
const pipelineLogs_1 = require("@/utils/pipelineLogs");
function TerminalLogViewer({ jobId, initialLog }) {
    const [autoScroll, setAutoScroll] = (0, react_1.useState)(true);
    const viewportRef = (0, react_1.useRef)(null);
    const { lines, status } = (0, pipelineLogs_1.usePipelineLogs)(jobId, initialLog);
    (0, react_1.useEffect)(() => {
        if (!autoScroll || !viewportRef.current)
            return;
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }, [autoScroll, lines]);
    return (<section className="terminal-shell">
      <div className="terminal-toolbar">
        <div className="terminal-title">
          <lucide_react_1.Terminal size={16}/>
          <span>Live Logs</span>
          <span className={`connection-dot ${status}`}/>
        </div>
        <div className="terminal-actions">
          <button className="icon-btn" title={autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"} onClick={() => setAutoScroll((value) => !value)}>
            {autoScroll ? <lucide_react_1.Pause size={15}/> : <lucide_react_1.Play size={15}/>}
          </button>
          <button className="icon-btn" title="Jump to bottom" onClick={() => {
            if (viewportRef.current)
                viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }}>
            <lucide_react_1.RotateCcw size={15}/>
          </button>
        </div>
      </div>
      <div ref={viewportRef} className="terminal-viewport">
        {lines.length === 0 ? (<div className="terminal-empty">Waiting for pipeline output...</div>) : (lines.map((line) => (<pre key={line.id} className={`terminal-line ${line.type}`}>
              <span>{new Date(line.ts).toLocaleTimeString()}</span>
              {line.message}
            </pre>)))}
      </div>
    </section>);
}

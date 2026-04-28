import { useEffect, useState } from 'react';

interface Job {
  id: string;
  name: string;
  data: any;
  state: 'completed' | 'failed' | 'active' | 'waiting';
  failedReason?: string;
  timestamp: number;
}

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/backup/jobs');
      if (!res.ok) throw new Error('Failed to fetch API');
      const data = await res.json();
      setJobs(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, []);

  const triggerTestBackup = async () => {
    try {
      await fetch('http://localhost:3000/api/backup/pgsql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          DB_HOST: "localhost",
          DB_USER: "gui_test_user",
          DB_PASS: "testpass",
          DB_NAME: "gui_db"
        })
      });
      fetchJobs();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="container">
      <header>
        <h1>DBBKP Platform</h1>
        <div>
          <span className="pulse"></span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {error ? 'API Offline' : 'System Operational'}
          </span>
        </div>
      </header>

      <div className="action-bar">
        <button onClick={triggerTestBackup}>+ Trigger Test Backup</button>
      </div>

      <div className="glass-panel">
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Active & Recent Jobs</h2>
        
        {loading ? (
          <div className="empty-state">Connecting to Control Plane...</div>
        ) : jobs.length === 0 ? (
          <div className="empty-state">No jobs in queue. Trigger a backup to see it here!</div>
        ) : (
          <div className="jobs-grid">
            {jobs.map(job => (
              <div key={job.id} className="job-card">
                <div className="job-info">
                  <h3>{job.name} <span style={{color:'var(--text-secondary)', fontSize:'0.9rem'}}>#{job.id}</span></h3>
                  <div className="job-meta">
                    Target: {job.data.db?.DB_NAME || 'Unknown DB'} @ {job.data.db?.DB_HOST || 'localhost'}
                    <br />
                    {new Date(job.timestamp).toLocaleString()}
                  </div>
                  {job.failedReason && (
                    <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem', maxWidth: '500px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {job.failedReason}
                    </div>
                  )}
                </div>
                <div>
                  <span className={`badge ${job.state}`}>{job.state}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import './App.css';

function add() {
  
  // Get selected file name from navigation state (if coming from Edit page)
  const location = useLocation();
  const selectedFileName = location.state?.fileName ?? null;
  
  const fileInputRef = useRef(null);
  //the file selected by the user
  const [selectedFile, setSelectedFile] = useState(null);
  //holds questions and answers
  const [processResult, setProcessResult] = useState(null);
  const [company, setCompany] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [ragThreshold, setRagThreshold] = useState('0.78');

  //the checkboxes
  const [sections, setSections] = useState({
    executiveSummary: false,
    companyOverview: false,
    projectApproach: false,
    deliverables: false,
    timeline: false,
    team: false,
    caseStudies: false,
  });

  //this is the Prompt box
  const [notes, setNotes] = useState([]);

  //console log box
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);

  // Add app log (for displaying app-related output like prompts, responses, etc.)
  const addAppLog = (message, type = 'log') => {
    setConsoleLogs(prev => {
      const newLogs = [...prev, { type, message, time: new Date().toLocaleTimeString(), expanded: false }];
      return newLogs.length > 100 ? newLogs.slice(-100) : newLogs;
    });
  };

  const toggleLogExpanded = (index) => {
    setConsoleLogs(prev => prev.map((log, idx) => idx === index ? { ...log, expanded: !log.expanded } : log));
  };

  //the preview page
  const handlePreview = () => {
    const previewData = {
        company,
        projectDesc,
        sections,
        questions: processResult?.questions,
        answers: processResult?.answers,
    };

    localStorage.setItem('previewData', JSON.stringify(previewData));
    window.open('/preview', '_blank');
  };
  
  // form data
  const loadFormData = (data) => {
    setProcessResult(data ?? null);
    setCompany(data?.company ?? '');
    setProjectDesc(data?.projectDesc ?? '');
    setSections(data?.sections ?? {
      executiveSummary: false,
      companyOverview: false,
      projectApproach: false,
      deliverables: false,
      timeline: false,
      team: false,
      caseStudies: false,
    });
    //the prompt boxes
    const questionCount = data?.questions?.length ?? 0;
    setNotes(new Array(questionCount).fill(''));
  };

  //  (Server Side Events) -  for real-time server logs
  useEffect(() => {
    const eventSource = new EventSource('http://localhost:3003/logs');
    
    eventSource.onmessage = (event) => {
      try {
        const { message, type } = JSON.parse(event.data);
        addAppLog(message, type);
      } catch (err) {
        console.error('Error parsing SSE message:', err);
      }
    };
    
    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      addAppLog('Lost connection to server logs', 'error');
    };
    
    return () => eventSource.close();
  }, []);

  // Fetch existing file if selected
  useEffect(() => {
    if (!selectedFileName) return;

    console.log('Loading file:', selectedFileName);

    fetch(`http://localhost:3003/load-existing?fileName=${encodeURIComponent(selectedFileName)}`)
      .then((res) => res.json())
      .then(loadFormData)
      .catch((err) => console.error('Error loading file:', err));
  }, [selectedFileName]);

  // File input handlers
  const handleChooseFile = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  // Checkbox handler
  const handleCheckboxChange = (key) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Process button (user picks file, then clicks process button)
  const handleProcess = async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('company', company);
    formData.append('projectDesc', projectDesc);
    formData.append('sections', JSON.stringify(sections));
    const threshold = parseFloat(ragThreshold);
    formData.append('ragThreshold', Number.isFinite(threshold) ? threshold.toString() : '0.78');

    try {
      const response = await fetch('http://localhost:3003/process-document', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      loadFormData(result);
    } catch (error) {
      console.error('Error processing document:', error);
      setProcessResult({ error: error.message });
      setNotes([]);
    }
  };

  // Re-process a single answer
  const handleReProcess = async (index, prompt) => {
    try {
      const response = await fetch('http://localhost:3003/reprocess-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: selectedFile?.name ?? selectedFileName,
          index,
          prompt,
          company,
          projectDesc,
          sections,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      // Update only the relevant answer and refresh prompt history from backend
      const updatedAnswers = [...(processResult?.answers ?? [])];
      updatedAnswers[index] = result.answer;

      setProcessResult({
        ...processResult,
        answers: updatedAnswers,
        promptHistory: result.promptHistory ?? processResult?.promptHistory,
      });
    } catch (error) {
      console.error('Error reprocessing document:', error);
    }
  };

  const handleClearPromptHistory = async () => {
    if (!processResult) return;

    const fileName = selectedFile?.name ?? selectedFileName;
    if (!fileName) {
      setProcessResult(prev => {
        const questionCount = prev.questions?.length ?? 0;
        return {
          ...prev,
          promptHistory: Array.from({ length: questionCount }, () => []),
        };
      });
      return;
    }

    try {
      const response = await fetch('http://localhost:3003/clear-prompt-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      setProcessResult(prev => ({
        ...prev,
        promptHistory: result.promptHistory ?? Array.from({ length: prev.questions?.length ?? 0 }, () => []),
      }));
    } catch (error) {
      console.error('Error clearing prompt history:', error);
    }
  };

  // Render
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <h1>Proposal Content Tool</h1>
        <h2>Add</h2>

      {/* File input */}
      <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
      <button onClick={handleChooseFile}>Choose File</button>
      {selectedFile && <span style={{ marginLeft: 8 }}>{selectedFile.name}</span>}
      <br /><br />

      <div style={{ margin: '0 auto', maxWidth: '600px' }}>
        {/* Company */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ width: '180px', fontWeight: 'bold' }}>Company:</div>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Enter company name"
            style={{ flex: 1, padding: '6px' }}
          />
        </div>

        {/* Project Description */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ width: '180px', fontWeight: 'bold' }}>Project Description:</div>
          <input
            type="text"
            value={projectDesc}
            onChange={(e) => setProjectDesc(e.target.value)}
            placeholder="Enter project description"
            style={{ flex: 1, padding: '6px' }}
          />
        </div>

        {/* RAG Threshold */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ width: '180px', fontWeight: 'bold' }}>RAG Threshold:</div>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={ragThreshold}
            onChange={(e) => setRagThreshold(e.target.value)}
            placeholder="0.78"
            style={{ flex: 1, padding: '6px' }}
          />
        </div>

        {/* Sections */}
        <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: '12px' }}>
          <div style={{ width: '180px', fontWeight: 'bold' }}>Include Sections:</div>
          <div>
            {[
              ['executiveSummary', 'Executive Summary'],
              ['companyOverview', 'Company Overview'],
              ['projectApproach', 'Project Approach'],
              ['deliverables', 'Deliverables'],
              ['timeline', 'Timeline'],
              ['team', 'Team & Expertise'],
              ['caseStudies', 'Relevant Case Studies'],
            ].map(([key, label]) => (
              <div key={key} style={{ marginBottom: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="checkbox"
                    checked={!!sections[key]}
                    onChange={() => handleCheckboxChange(key)}
                  />
                  {label}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      <br />

      {/* Process button */}
      <button onClick={handleProcess} disabled={!selectedFile || !company.trim() || !projectDesc.trim()}>
        Process
      </button>

      <br />
      {/* Preview button */}
      <button onClick={handlePreview} disabled={!processResult}>
        Preview
      </button>
      {processResult?.promptHistory?.length > 0 && (
        <button
          onClick={handleClearPromptHistory}
          style={{ marginLeft: '10px' }}
        >
          Clear Prompt History
        </button>
      )}

      {/* Process Result */}
      {processResult && (
        <div style={{ marginTop: 16 }}>
          <h3>Process Result:</h3>
          {processResult.questions && processResult.answers ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #ddd', padding: '8px', width: '60%' }}>Question & Answer</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', width: '30%' }}>Prompt</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', width: '10%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {processResult.questions.map((question, index) => (
                  <tr key={index}>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      {/* Question */}
                      <details open>
                        <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Question</summary>
                        <div style={{ marginTop: '6px' }}>{question}</div>
                      </details>

                      {/* Answer */}
                      <details style={{ marginTop: '10px' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Answer</summary>
                        <div style={{ marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                          {processResult.answers[index] ?? 'N/A'}
                        </div>
                      </details>

                      {/* RAG Score */}
                      <div style={{ marginTop: '8px', fontSize: '12px', color: typeof processResult.ragScore?.[index] === 'number' && processResult.ragScore[index] > ragThreshold ? 'green' : '#666' }}>
                        RAG Score: {processResult.ragScore?.[index] ?? 'N/A'}
                      </div>

                      {/* Retrieved Context */}
                      <details style={{ marginTop: '6px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '12px' }}>View Retrieved Context</summary>
                        <div style={{ marginTop: '4px', fontSize: '12px', color: '#555' }}>
                          {processResult.ragAnswers?.[index] ?? 'N/A'}
                        </div>
                      </details>
                    </td>

                    {/* Notes */}
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      <textarea
                        value={notes[index] ?? ''}
                        onChange={(e) => {
                          const newNotes = [...notes];
                          newNotes[index] = e.target.value;
                          setNotes(newNotes);
                        }}
                        style={{ width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', padding: '4px' }}
                        rows={5}
                      />
                      {processResult?.promptHistory?.[index]?.length > 0 && (
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#ccc' }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Prompt history:</div>
                          {processResult.promptHistory[index].map((entry, historyIndex) => (
                            <div key={historyIndex} style={{ marginBottom: '2px' }}>
                              <strong>{entry.time}</strong>: {entry.prompt}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      <button onClick={() => handleReProcess(index, notes[index])}>Re-process</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre>{JSON.stringify(processResult, null, 2)}</pre>
          )}
        </div>
      )}
      </div>

      {/* Console Log Box */}
      <div style={{ borderTop: '2px solid #ddd', backgroundColor: '#f5f5f5', display: 'flex', flexDirection: 'column' }}>
        <button 
          onClick={() => setIsConsoleOpen(!isConsoleOpen)}
          style={{ padding: '10px', textAlign: 'left', backgroundColor: '#e0e0e0', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {isConsoleOpen ? '▼' : '▶'} Console ({consoleLogs.length})
        </button>
        
        {isConsoleOpen && (
          <div style={{ height: '33vh', overflow: 'auto', backgroundColor: '#000', color: '#0f0', fontFamily: 'monospace', padding: '8px', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {consoleLogs.length === 0 ? (
              <div style={{ color: '#888' }}>No console output yet...</div>
            ) : (
              consoleLogs.map((log, idx) => (
                <div 
                  key={idx} 
                  style={{ 
                    color: log.type === 'error' ? '#ff6b6b' : log.type === 'warn' ? '#ffd93d' : '#0f0',
                    marginBottom: '4px'
                  }}
                >
                  <span style={{ color: '#888' }}>[{log.time}]</span>{' '}
                  {log.expanded || log.message.length <= 100 ? log.message : `${log.message.slice(0, 100)}...`}
                  {log.message.length > 100 && (
                    <button
                      onClick={() => toggleLogExpanded(idx)}
                      style={{
                        marginLeft: '8px',
                        background: 'transparent',
                        border: 'none',
                        color: '#88f',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: '12px',
                        padding: 0,
                      }}
                    >
                      {log.expanded ? '[- Less]' : '[+ More]'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default add;
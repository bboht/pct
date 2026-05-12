// src/Preview.jsx
import { useLocation } from 'react-router-dom';

function Preview() {
    const stored = localStorage.getItem('previewData');
    const data = stored ? JSON.parse(stored) : null;

  if (!data) {
    return <div>No preview data available</div>;
  }

  const sections = data.sections || {};

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Proposal Preview</h1>

      {/* company name and project desc */}
      <h2>{data.company}</h2>
      <p>{data.projectDesc}</p>

      <hr />

      {/* Section placeholders */}
      {sections.executiveSummary && <h2>Executive Summary Placeholder</h2>}
      {sections.companyOverview && <h2>Company Overview Placeholder</h2>}
      {sections.projectApproach && <h2>Project Approach Placeholder</h2>}
      {sections.deliverables && <h2>Deliverables Placeholder</h2>}
      {sections.timeline && <h2>Timeline Placeholder</h2>}
      {sections.team && <h2>Team & Expertise Placeholder</h2>}
      {sections.caseStudies && <h2>Relevant Case Studies Placeholder</h2>}

      <hr />

      {data.questions?.map((q, i) => (
        <div key={i} style={{ marginBottom: '20px' }}>
          <h3>Q: {q}</h3>
          <p><strong>A:</strong> {data.answers?.[i]}</p>
        </div>
      ))}
    </div>
  );
}

export default Preview;
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function edit() {
  const [files, setFiles] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('http://localhost:3003/load-files')
      .then(res => res.json())
      .then(data => setFiles(data.files || []))
      .catch(err => console.error(err));
  }, []);

  // Navigate to Add page
  const handleSelectFile = (fileName) => {
    console.log('Edit Page - selectedFileName:', fileName);
    navigate('/add', { state: { fileName } });
  };

  // Delete file
  const handleDelete = async (fileName, e) => {
    e.stopPropagation(); // prevent triggering select

    if (!window.confirm(`Delete ${fileName}?`)) return;

    try {
      const response = await fetch('http://localhost:3003/delete-file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      // Remove from UI
      setFiles(files.filter(f => f !== fileName));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div style={{ textAlign: 'center' }}>
    <h1>Proposal Content Tool</h1>
    <h2>Select Existing File</h2>

    <ul style={{ listStyle: 'none', padding: 0, maxWidth: '500px', margin: '0 auto' }}>
        {files.map((file, index) => (
        <li
            key={index}
            style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px',
            borderBottom: '1px solid #ddd'
            }}
        >
            <span
            style={{ color: 'blue', cursor: 'pointer' }}
            onClick={() => handleSelectFile(file)}
            >
            {file}
            </span>

            <button
            onClick={(e) => handleDelete(file, e)}
            style={{ color: 'red' }}
            >
            Delete
            </button>
        </li>
        ))}
    </ul>
    </div>
  );
}

export default edit;
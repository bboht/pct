import { useState, useEffect, useRef } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'


function App() {
  // State to hold the count value (from the Vite boilerplate)
  const [count, setCount] = useState(0)
  // State to hold the data fetched from the backend
  const [data, setData] = useState(null)
  // State to hold the selected file object
  const [selectedFile, setSelectedFile] = useState(null)
  // State to hold the process result
  const [processResult, setProcessResult] = useState(null)
  // State to hold notes for each question
  const [notes, setNotes] = useState([])
  // Ref for the file input
  const fileInputRef = useRef(null)

  // Handler to open file dialog
  const handleChooseFile = () => {
    fileInputRef.current.click()
  }

  // Handler for when the user selects a file
  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
  }

  // Handler to call the process-document API with the selected file
  const handleProcess = async () => {
    if (!selectedFile) return

    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      // Call the process-document API
      const response = await fetch('http://localhost:3003/process-document', {
        method: 'POST',
        body: formData,
      })

      console.log('Response status:', response.status)
      console.log('Response ok:', response.ok)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Response text:', errorText)
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`)
      }

      // Parse the JSON response and display the result
      const result = await response.json()
      console.log('process-document response:', result)
      setProcessResult(result)
      setNotes(new Array(result.questions?.length || 0).fill(''))
    } catch (error) {
      console.error('Error calling process-document:', error)
      setProcessResult({ error: error.message })
      setNotes([])
    }
  }

  // Handler to call the process-document API with the selected file
  const handleReProcess = async (index, prompt) => {

    try {
      // Call the process-document API
      const response = await fetch('http://localhost:3003/reprocess-document', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },
                body: JSON.stringify({
            fileName: selectedFile.name,
            index: index,
            prompt: prompt
          })

      })

      console.log('Reprocess Response status:', response.status)
      console.log('Reprocess Response ok:', response.ok)


    } catch (error) {
      console.error('Error calling process-document:', error)
      //setReProcessResult({ error: error.message })
    }
  }

  return (
    <div>
      {/* Heading */}
      <h1>Proposal Content Tool</h1>

      {/* The Choose File input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button onClick={handleChooseFile}>Choose File</button>
      {selectedFile && <span style={{ marginLeft: 8 }}>{selectedFile.name}</span>}
      <br />
      {/* The Process button */}
      <button onClick={handleProcess} disabled={!selectedFile}>
        Process
      </button>
      {processResult && (
        <div style={{ marginTop: 16 }}>
          <h3>Process Result:</h3>
          {processResult.questions && processResult.answers ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left', width: '30%' }}>Question</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left', width: '30%' }}>Answer</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left', width: '30%' }}>Notes</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'left', width: '10%' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {processResult.questions.map((question, index) => (
                  <tr key={index}>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{question}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{processResult.answers[index] || 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      <textarea
                        value={notes[index] || ''}
                        onChange={(e) => {
                          const newNotes = [...notes]
                          newNotes[index] = e.target.value
                          setNotes(newNotes)
                        }}
                        style={{ width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', padding: '4px' }}
                        rows={5}
                      />
                    </td><td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      {/* The re-process button */}
                      <button onClick={() => handleReProcess(index,notes[index])}>Re-process</button>
                    </td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre>{JSON.stringify(processResult, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

export default App

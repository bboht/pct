import { Routes, Route, Link, useLocation } from 'react-router-dom'
import AddPage from './add'
import EditPage from './edit'
import Preview from './Preview'

function App() {
  const location = useLocation();

  // Hide nav on preview page
  const hideNav = location.pathname === '/preview';

  return (
    <>
      {!hideNav && (
        <nav>
          <Link to="/">Select File</Link> | <Link to="/add">Update</Link>
        </nav>
      )}

      <Routes>
        <Route path="/" element={<EditPage />} />
        <Route path="/add" element={<AddPage />} />
        <Route path="/preview" element={<Preview />} />
      </Routes>
    </>
  )
}

export default App
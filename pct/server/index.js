import express from 'express'
import multer from 'multer'
import 'dotenv/config'
import OpenAI from 'openai'
import { MongoClient, ObjectId } from 'mongodb'

const app = express()
const PORT = 3003

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// MongoDB connection string – default for Atlas Local (directConnection for single-node/local)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/?directConnection=true'
const DB_NAME = 'pct'
const RETRY_MS = 3000

let db = null
let client = null

// Function to connect to MongoDB with retry logic
async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI)
    await client.connect()
    db = client.db(DB_NAME)
    await db.command({ ping: 1 })
    console.log('Connected to MongoDB')
  } catch (err) {
    console.warn('MongoDB connection failed:', err.message, '- retrying in', RETRY_MS / 1000, 's')
    setTimeout(connectDB, RETRY_MS)
  }
}


app.use(express.json());

// Configure multer for file uploads
const upload = multer()

// Middleware to allow CORS (for development purposes)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  next()
})

// Basic route to test the server
app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express' })
})

// Handle preflight OPTIONS request for CORS
app.options('/process-document', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(200)
})
// Handle preflight OPTIONS request for CORS
app.options('/reprocess-document', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(200)
})


// Route to handle file uploads and processing
app.post('/process-document', upload.single('file'), async (req, res) => {
  console.log('Received request to /process-document')
  if (!req.file) {
    console.log('No file uploaded')
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const filename = req.file.originalname
  const fileText = req.file.buffer.toString('utf8')

  //Check if this file has already been processed and stored in MongoDB
  if (db) {
    try {
      console.log('Checking MongoDB for existing file:', filename)
      const existingDoc = await db.collection('rfp_docs').findOne({ fileName: filename })
      if (existingDoc) {
        console.log('File already exists in MongoDB:', filename)
        //set questions to the existing questions from MongoDB, and answers to empty strings (since we don't need to show them in the UI, but we want to keep the array lengths consistent for notes)
        const questions = existingDoc.questions || []
        const answers = existingDoc.answers || []

        return res.json({ 
          questions,
          answers,
          message: 'Questions re-loaded from MongoDB'
        })
      }
    } catch (err) {
      console.error('Error checking existing document:', err)
    }
  }


  // For now, just log the variables (since the API doesn't do anything yet)
  console.log('Filename:', filename)
  console.log('File text length:', fileText.length)

  //Extract questions from the document
  console.log('Extracting questions', filename)
  const extractResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a document analyzer. Extract every question or request for information from the document text. Return ONLY a JSON array of strings, where each string is a question or request. If there are no questions, return an empty array []. Do not include any other text or explanation.'
      },
      {
        role: 'user',
        content: `Extract all questions and requests for information from this document:\n\n${fileText}`
      }
    ],
    temperature: 0.3,
  })

  // initially set questions to an empty array in case parsing fails
  let questions = []
  // The response content may be wrapped in markdown code blocks, so we need to extract the JSON array from it
  try {
    const content = extractResponse.choices[0].message.content.trim()
    // Remove markdown code blocks if present
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    // If a JSON array is found, parse it; otherwise, try to parse the entire content
    if (jsonMatch) {
      questions = JSON.parse(jsonMatch[0])
    } else {
      questions = JSON.parse(content)
    }
  } catch (err) {
    console.error('Error parsing questions:', err)
    return res.status(500).json({ error: 'Failed to parse extracted questions' })
  }


  // If no questions are found, return an empty array with a message
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.json({ 
      questions: [],
      answers: [],
      message: 'No questions found in the document'
    })
  }

  // Generate answers for each question
  console.log('generating answer', filename)
  const answers = []
  for (const question of questions) {
    try {
      const answerResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Answer the question using your general knowledge. Always provide a helpful, informative response.'
          },
          {
            role: 'user',
            content: `Question: ${question}\n\nProvide a clear, comprehensive answer using your general knowledge.`
          }
        ],
        temperature: 0.5,
      })
      // Extract the answer text from the response
      const answer = answerResponse.choices[0].message.content.trim()
      // Add the answer to the answers array
      answers.push(answer)
    } catch (err) {
      console.error('Error generating answer for question:', question, err)
      answers.push('Error generating answer')
    }
  }




  // Store results in MongoDB (including question embeddings)
  console.log('Saving to MongoDB', filename)
 let savedId = null
  if (db) {
    try {
      const insertResult = await db.collection('rfp_docs').insertOne({
        fileName: req.file.originalname,
        questions,
        answers,
        processedAt: new Date(),
      })
      savedId = insertResult.insertedId.toString()
    } catch (err) {
      console.warn('Failed to save to MongoDB:', err.message)
    }
  } else {
    console.warn('No database connection available, skipping MongoDB storage')
  }





  // Return both questions and answers
  res.json({ 
    questions,
    answers,
    message: 'Questions extracted and answered successfully'
  })

})




// re-process route to handle re-processing of the same document (e.g. if user adds notes and wants to update the answers based on the notes). 
app.post('/reprocess-document', async (req, res) => {
  console.log('Received request to /reprocess-document answer')

  console.log(req.body);

  res.json({ message: '/reprocess-document complete' });

})



// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})

// Connect to MongoDB when the server starts
connectDB()

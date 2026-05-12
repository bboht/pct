import express from 'express'
import multer from 'multer'
import 'dotenv/config'
import OpenAI from 'openai'
import { MongoClient, ObjectId } from 'mongodb'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const mammoth = require('mammoth')
const pdfParse = require('pdf-parse')

const app = express()
const PORT = 3003

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

//Summary of APIs
//process-document - user selects a file for the first time and clicks process.  loads the questions and answers
//reprocess-document - enter a prompt and re-process a single quesiton
//load-files - load the files for the select page
//load-existing - load a single existing file and data
//delete-file - delete a file


// MongoDB connection string – default for Atlas Local (directConnection for single-node/local)
//local MongoDB :
//const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/?directConnection=true'

//Atlas MongoDB :
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://bboht1_db_user:LG8VSkBIYUimW65c@cluster0.hxu6nat.mongodb.net/?appName=Cluster0'


const DB_NAME = 'pct'
const RETRY_MS = 3000

let db = null
let client = null

// SSE clients for real-time logging
const sseClients = []

// Function to broadcast logs to all connected clients
const broadcastLog = (message, type = 'log') => {
  sseClients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify({ message, type, timestamp: new Date().toISOString() })}\n\n`)
    } catch (err) {
      // Remove broken client
      const index = sseClients.indexOf(client)
      if (index > -1) sseClients.splice(index, 1)
    }
  })
}

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
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }
  next()
})

// Basic route to test the server
app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express' })
})

// SSE endpoint for real-time logging
app.get('/logs', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  })

  // Add this client to the list
  sseClients.push(res)

  // Remove client when connection closes
  req.on('close', () => {
    const index = sseClients.indexOf(res)
    if (index > -1) sseClients.splice(index, 1)
  })
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
// Handle preflight OPTIONS request for CORS
app.options('/load-files', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(200)
})
// Handle preflight OPTIONS request for CORS
app.options('/load-existing', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(200)
})
// Handle preflight OPTIONS request for CORS
app.options('/delete-file', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'DELETE')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(200)
})




// Route to handle file uploads and processing
app.get('/load-existing', async (req, res) => {
  //Check if this file has already been processed and stored in MongoDB
  const filename = req.query.fileName;
  console.log('Checking MongoDB for existing file:', filename)
  if (db) {
    try {

      const checkFileExistsResult = await checkIfFileExists(db, filename);
      if (checkFileExistsResult.success) {
        return res.json({ 
          questions: checkFileExistsResult.data.questions,
          answers: checkFileExistsResult.data.answers,
          ragAnswers: checkFileExistsResult.data.ragAnswers,
          ragScore: checkFileExistsResult.data.ragScore,
          company: checkFileExistsResult.data.company,
          projectDesc: checkFileExistsResult.data.projectDesc,
          sections: checkFileExistsResult.data.sections,
          promptHistory: checkFileExistsResult.data.promptHistory,
          message: 'Questions re-loaded from MongoDB'
        })
      }
    } catch (err) {
      console.error('Error loading existing document:', err)
    }
  }

})





// handle file uploads and processing
app.post('/process-document', upload.single('file'), async (req, res) => {
  console.log('Received request to /process-document')
  if (!req.file) {
    console.log('No file uploaded')
    broadcastLog('No file uploaded', 'error')
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const filename = req.file.originalname
  const fileExtension = filename.toLowerCase().split('.').pop()
  let fileText = ''
  
  try {
    if (fileExtension === 'pdf') {
      // Parse PDF
      const pdfData = await pdfParse(req.file.buffer)
      fileText = pdfData.text
    } else if (fileExtension === 'docx') {
      // Parse DOCX (Word document)
      const result = await mammoth.extractRawText({ buffer: req.file.buffer })
      fileText = result.value
    } else {
      // Parse as plain text (includes .txt and others)
      fileText = req.file.buffer.toString('utf8')
    }
  } catch (err) {
    console.error('Error extracting text from file:', err)
    broadcastLog(`Error extracting text from file: ${err.message}`, 'error')
    return res.status(500).json({ error: 'Failed to extract text from file' })
  }
  
  const company = req.body.company || ''
  const projectDesc = req.body.projectDesc || ''
  const sections = req.body.sections ? JSON.parse(req.body.sections) : {}
  const ragThreshold = parseFloat(req.body.ragThreshold) || 0.78

  broadcastLog(`Processing file: ${filename}`, 'log')
  broadcastLog(`Company: ${company}`, 'log')
  broadcastLog(`Project: ${projectDesc}`, 'log')
  
  //Check if this file has already been processed and stored in MongoDB
  if (db) {
    try {

      console.log('Checking MongoDB for existing file:', filename)
      const checkFileExistsResult = await checkIfFileExists(db, filename);
      if (checkFileExistsResult.success) {
        //this file has already been saved to the db, so just load it and return
        broadcastLog('File already processed, loading from cache', 'log')
        return res.json({ 
          questions: checkFileExistsResult.data.questions,
          answers: checkFileExistsResult.data.answers,
          company: checkFileExistsResult.data.company,
          projectDesc: checkFileExistsResult.data.projectDesc,
          sections: checkFileExistsResult.data.sections,
          promptHistory: checkFileExistsResult.data.promptHistory,
          message: 'Questions re-loaded from MongoDB'
        })
      }
    } catch (err) {
      console.error('Error checking existing document:', err)
    }
  }

  console.log('Filename:', filename)
  console.log('File text length:', fileText.length)

  //Extract questions from the document
  broadcastLog('Extracting questions from document...', 'log')
  console.log('Extracting questions', filename)
  const extractResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a document analyzer. Extract every question or request for information from the document text. Include any statements that pose requirements or requests such as "The system shall", "Describe", "Explain", "List", "Detail", etc. Treat these as questions to be answered. Return ONLY a JSON array of strings, where each string is a question or request. If there are no questions, return an empty array []. Do not include any other text or explanation.'
      },
      {
        role: 'user',
        content: `Extract all questions and requests for information from this document. Include statements like "The system shall", "Describe", "Explain", etc. as these should be treated as questions requiring answers:\n\n${fileText}`
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
    broadcastLog(`Found ${questions.length} questions`, 'log')
  } catch (err) {
    console.error('Error parsing questions:', err)
    broadcastLog('Error parsing extracted questions', 'error')
    return res.status(500).json({ error: 'Failed to parse extracted questions' })
  }


  // If no questions are found, return an empty array with a message
  if (!Array.isArray(questions) || questions.length === 0) {
    broadcastLog('No questions found in the document', 'warn')
    return res.json({ 
      questions: [],
      answers: [],
      message: 'No questions found in the document'
    })
  }

  // Generate embeddings for the questions
  broadcastLog('Generating question embeddings...', 'log')
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: questions,
  })
  const questionEmbeddings = {}
  for (const e of embeddingResponse.data) {
    questionEmbeddings[e.index] = e.embedding
  }


  // Generate answers for each question
  broadcastLog(`Generating answers for ${questions.length} questions...`, 'log')
  console.log('generating answer', filename)
  const answers = []
  const ragAnswers = []
  const ragScore = []
  let idx = 0
  for (const question of questions) {
    
    try {
      broadcastLog(`Processing question ${idx + 1}/${questions.length}: ${question.substring(0, 50)}...`, 'log')
      // Do a vector search on the MongoDB for this question to see if there is any 
      // RAG data to feed into the prompt
      //https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/
      //https://mongodb-node.netlify.app/docs/drivers/node/current/atlas-vector-search/?utm_source=chatgpt.com
      //https://docs.langchain.com/oss/javascript/integrations/vectorstores/mongodb_atlas?utm_source=chatgpt.com

      console.log('doing vector search')
      const vectorResults = await db.collection('company_doc_chunks').aggregate([
      {
        //search the company docs for the closest match to the question embedding
        $vectorSearch: {
          index: "vector_index",                // your index name
          path: "embedding",                    // field in your docs
          queryVector: questionEmbeddings[idx],   // your question embedding
          numCandidates: 100,                   // how many to scan
          limit: 1                              // how many results to return
        }
      },
      {
        $project: {
          text: 1,
          score: { $meta: "vectorSearchScore" }
        }
      }
      ]).toArray();

      // add the retrieved text to the ragAnswers array (or a default message if no results)
      ragAnswers.push(vectorResults[0]?.text || 'No relevant information found in documents')
      // add the score or 0 if no results  
      ragScore.push(vectorResults[0]?.score || 0)
      console.log('outputing vector search results');
      console.log('increasing idx')
      idx++
      console.log('generating answers')

      //decide if we are including RAG content
      //if the score is > ragThreshold we include the RAG content.
      const userPrompt =
        vectorResults[0]?.score > ragThreshold
          ? `Question: ${question}\n\nBased on the following retrieved information from the document, provide a clear and comprehensive answer to the question. If the retrieved information is not relevant or insufficient to answer the question, provide your best answer based on your general knowledge.\n\nRetrieved Information:\n${vectorResults[0]?.text || 'No relevant information found in documents'}`
          : `Question: ${question}\n\nProvide a clear and comprehensive answer to the question based on your general knowledge.`;


      if (vectorResults[0]?.score > ragThreshold) {
        broadcastLog(`RAG content included for question ${idx} will be used`, 'log')
      }

          console.log(userPrompt);

      //generate answer for question
      const answerResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Answer the question using your general knowledge. Always provide a helpful, informative response.'
          },
          {
            role: 'user',
            content: userPrompt
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
  broadcastLog('Saving results to database...', 'log')
  console.log('Saving to MongoDB', filename)
 let savedId = null
  const promptHistory = questions.map(() => []);

  if (db) {
    try {
      const insertResult = await db.collection('rfp_docs').insertOne({
        fileName: req.file.originalname,
        questions,
        answers,
        questionEmbeddings,
        ragAnswers,
        ragScore,
        company,
        projectDesc,
        sections,
        promptHistory,
        processedAt: new Date(),
      })
      savedId = insertResult.insertedId.toString()
      broadcastLog('Results saved successfully', 'log')
    } catch (err) {
      console.warn('Failed to save to MongoDB:', err.message)
      broadcastLog('Failed to save to database', 'error')
    }
  } else {
    console.warn('No database connection available, skipping MongoDB storage')
    broadcastLog('Database not available, results not saved', 'warn')
  }


  // Return both questions and answers
  broadcastLog('Document processing complete!', 'log')
  res.json({ 
    questions,
    answers,
    ragAnswers,
    ragScore,
    company,
    projectDesc,
    sections,
    promptHistory,
    message: 'Questions extracted and answered successfully'
  })

})




// Delete file by fileName
app.delete('/delete-file', async (req, res) => {
  const { fileName } = req.body;

  if (!fileName) {
    return res.status(400).json({ error: 'fileName is required' });
  }

  if (!db) {
    return res.status(500).json({ error: 'Database not connected' });
  }

  try {
    console.log('Deleting file:', fileName);

    const result = await db.collection('rfp_docs').deleteOne({
      fileName: fileName
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    return res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (err) {
    console.error('Error deleting file:', err);
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});
// Clear session prompt history for a file (clears both session and persistent history)
app.post('/clear-prompt-history', async (req, res) => {
  const { fileName } = req.body;

  if (!fileName) {
    return res.status(400).json({ error: 'fileName is required' });
  }

  if (!db) {
    return res.status(500).json({ error: 'Database not connected' });
  }

  try {
    const existingDoc = await db.collection('rfp_docs').findOne({ fileName });
    if (!existingDoc) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Clear the prompt history in the database
    const clearedPromptHistory = Array.from({ length: existingDoc.questions.length }, () => []);
    await db.collection('rfp_docs').updateOne({ fileName }, { $set: { promptHistory: clearedPromptHistory } });

    broadcastLog(`Prompt history cleared for ${fileName}`, 'log');
    return res.json({ promptHistory: clearedPromptHistory });
  } catch (err) {
    console.error('Error clearing prompt history:', err);
    return res.status(500).json({ error: 'Failed to clear prompt history' });
  }
});

// re-process route to handle re-processing of the same document (e.g. if user adds notes and wants to update the answers based on the notes). 
app.post('/reprocess-document', async (req, res) => {
  console.log('Received request to /reprocess-document answer')

  console.log(req.body);
    const { fileName, index, prompt } = req.body

  //get the question and answer from the MongoDB
  if (db) {
    try {
      console.log('Checking MongoDB for existing file:', fileName)
      const existingDoc = await db.collection('rfp_docs').findOne({ fileName: fileName })
      if (existingDoc) {
        //set question and answer from MongoDB
        const question = existingDoc.questions[index]
        const answer = existingDoc.answers[index]

        // display the progress to the app log
        const questionPreview = question
        broadcastLog(`Re-processing answer for question: ${questionPreview}`, 'log')
        console.log('Found existing question:', question)

        //determine if there have been prompts already this session and 
        //run it through open ai to see if we want to generate a better prompt
        //for the user






        const previousPrompts = Array.isArray(existingDoc.promptHistory?.[index]) ? existingDoc.promptHistory[index].map(entry => entry.prompt) : [];
        let enhancedPrompt = prompt;

        if (previousPrompts.length > 0) {
          const historyText = previousPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n');
          const enhanceInstructions = `You are a prompt enhancement assistant. Given the prompt history of previous interactions and the current prompt, enhance the current prompt to explicitly incorporate relevant context from the history. If the current prompt references something vague (like "what we had before" or "our previous choice"), resolve those references using the prompt history. Return ONLY the enhanced prompt, nothing else.`;
          const enhanceContent = `Prompt history (previous interactions):\n${historyText}\n\nCurrent prompt:\n${prompt}`;

          broadcastLog(`Enhancing prompt with historical context: ${enhanceContent}`, 'log');

          try {
            const enhanceResponse = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: enhanceInstructions
                },
                {
                  role: 'user',
                  content: enhanceContent
                }
              ],
              temperature: 0.5,
            });

            enhancedPrompt = enhanceResponse.choices[0].message.content.trim();
            broadcastLog(`Prompt enhanced with history: ${enhancedPrompt}`, 'log');
          } catch (err) {
            console.warn('Error enhancing prompt with history:', err);
            broadcastLog('Could not enhance prompt with history, using original', 'warn');
          }
        }

        //display the prompt we are about to process in the app log
        const promptContent = `Here is the current answer:\n\n${answer}\n\nUser's instructions for updating/refining this answer:\n${enhancedPrompt}\n\nPlease provide an updated answer based on the user's instructions.`
        const promptPreview = enhancedPrompt
        //broadcastLog(`Updated prompt: ${promptPreview}`, 'log')

        //OpenAI call to update the answer based on the prompt
        const answerResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Refine the response based on the user\'s instructions.'
            },
            {
              role: 'user',
              content: promptContent
            }
          ],
          temperature: 0.5,
        })

        // Extract the answer text from the response
        const updatedAnswer = answerResponse.choices[0].message.content.trim()

        console.log('Updated Answer:', updatedAnswer)
        broadcastLog('Answer updated successfully', 'log')

        // Update the answer and prompt history in MongoDB
        const entry = { prompt, time: new Date().toISOString() };
        const updatedPromptHistory = existingDoc.promptHistory?.map((entryArray) => Array.isArray(entryArray) ? [...entryArray] : []) ?? Array.from({ length: existingDoc.questions.length }, () => []);
        updatedPromptHistory[index] = [...(updatedPromptHistory[index] || []), entry];

        const updateResult = await db.collection('rfp_docs').updateOne(
          { fileName: fileName },
          { $set: { [`answers.${index}`]: updatedAnswer, promptHistory: updatedPromptHistory } }
        )

        console.log('Updated Answer in MongoDB results:', updateResult)

        return res.json({ 
          answer: updatedAnswer,
          promptHistory: updatedPromptHistory,
        })
      }
    } catch (err) {
      console.error('Error checking existing document:', err)
      broadcastLog('Error re-processing question', 'error')
    }
  }

  res.json({ message: '/reprocess-document complete' });

})

// handle file uploads and processing
app.get('/load-files', async (req, res) => {

  try {
      console.log('Loading file listing');
      // Fetch only the fileName field for all documents
      const files = await db
        .collection('rfp_docs')
        .find({}, { projection: { fileName: 1, _id: 0 } })
        .toArray();

      // Map to a simple array of file names
      const fileList = files.map(f => f.fileName);

      return res.json({ files: fileList });
    } catch (err) {
      console.error('Error fetching files from MongoDB:', err);
      return res.status(500).json({ error: 'Failed to fetch files' });
    }
})

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})

// Function to check if a file with the same name already exists in MongoDB and return its data if it does
async function checkIfFileExists(db, filename) {
  if (!db) return false;

  try {
    console.log('Checking MongoDB for existing file:', filename);

    const existingDoc = await db
      .collection('rfp_docs')
      .findOne({ fileName: filename });

    if (existingDoc) {
      console.log('File already exists in MongoDB:', filename);

      return {
        success: true,
        data: {
          questions: existingDoc.questions || [],
          answers: existingDoc.answers || [],
          ragAnswers: existingDoc.ragAnswers || [],
          ragScore: existingDoc.ragScore || [],
          company: existingDoc.company || '',
          projectDesc: existingDoc.projectDesc || '',
          sections: existingDoc.sections || {},
          promptHistory: existingDoc.promptHistory || Array.from({ length: (existingDoc.questions || []).length }, () => [])
        }
      };
    }

    return { success: false }; // file not found

  } catch (err) {
    console.error('Error checking existing document:', err);
    return { success: false, error: err };
  }
}

// Connect to MongoDB when the server starts
connectDB()

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("FATAL: GEMINI_API_KEY is not set.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

app.post('/api/generate-quote', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const textInput = req.body.text || '';
    const trade = req.body.trade || 'General Contractor';
    const actionType = req.body.actionType || 'quote';
    const audioFile = req.files && req.files['audio'] ? req.files['audio'][0] : null;
    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const parts = [];
    parts.push({ text: `You are an expert ${trade} assistant. Action type: ${actionType}. User notes: ${textInput}` });

    if (imageFile) {
      parts.push({
        inlineData: {
          data: imageFile.buffer.toString('base64'),
          mimeType: imageFile.mimetype || 'image/jpeg'
        }
      });
    }

    if (audioFile) {
      parts.push({
        inlineData: {
          data: audioFile.buffer.toString('base64'),
          mimeType: audioFile.mimetype || 'audio/webm'
        }
      });
    }

    const result = await model.generateContent(parts);
    const responseText = result.response.text();

    res.json({ success: true, reply: responseText });

  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

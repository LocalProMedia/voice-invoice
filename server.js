// server.js (Dual-Engine: Operations & Marketing Intelligence)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('\n[FATAL] GEMINI_API_KEY is not set.\n');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

async function verifyGumroadLicense(licenseKey) {
  if (!licenseKey) return false;
  // Bypass for rapid development:
  if (licenseKey === "TEST-MODE") return true;

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_permalink: process.env.GUMROAD_PERMALINK || 'YOUR_GUMROAD_PRODUCT_PERMALINK',
        license_key: licenseKey
      })
    });
    const data = await response.json();
    return data.success && !data.uses;
  } catch (err) {
    console.error('License check error:', err);
    return false;
  }
}

app.post('/api/generate-quote', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const licenseKey = req.headers['x-license-key'];
    const isValidLicense = await verifyGumroadLicense(licenseKey);
    if (!isValidLicense) {
      return res.status(401).json({ error: 'Active Gumroad license required.' });
    }

    const textInput = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
    const trade = req.body && req.body.trade ? req.body.trade : 'General Contractor';
    const actionType = req.body && req.body.actionType ? req.body.actionType : 'quote'; // 'quote' or 'marketing'
    const audioFile = req.files && req.files['audio'] ? req.files['audio'][0] : null;
    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;

    if (!audioFile && !imageFile && !textInput) {
      return res.status(400).json({ error: 'Please provide text, audio, or a screenshot.' });
    }

    let systemInstruction = "";
    
    if (actionType === 'marketing') {
      systemInstruction = `
You are a Growth Marketing & Reputation Intelligence Engine for home service professionals (${trade}).
Analyze the provided screenshot (which may be a Yelp page, Instagram/Facebook feed, customer reviews, or a social template library) and accompanying notes.

Produce an action plan formatted strictly as JSON with this exact schema:
{
  "type": "marketing",
  "business_name": "Extracted business name or Valued Trade Pro",
  "audit_findings": [
    "Key observation about Yelp profile, ratings, missing details, or template match"
  ],
  "social_templates": [
    {
      "platform": "Instagram / Facebook / Nextdoor",
      "hook": "Attention-grabbing headline",
      "caption": "Full post copy matching the tone of high-ticket ${trade} work",
      "call_to_action": "Contact link or direct dial recommendation",
      "suggested_visual": "Recommendation of what photo/template layout to use"
    }
  ]
}
      `.trim();
    } else {
      systemInstruction = `
You are an expert AI estimating engine for home service professionals specializing in: ${trade}.
Extract the client name, job address, and itemized billing details into clean line items.
If prices or materials are not stated, use Google Search grounding to populate accurate local market rates.

Produce an invoice formatted strictly as JSON with this exact schema:
{
  "type": "quote",
  "client_name": "",
  "address": "",
  "line_items": [
    { "description": "", "quantity": 1, "rate": 0 }
  ]
}
      `.trim();
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction,
      tools: [{ googleSearch: {} }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    });

    const parts = [];
    if (audioFile) parts.push({ inlineData: { mimeType: audioFile.mimetype || 'audio/webm', data: audioFile.buffer.toString('base64') } });
    if (imageFile) parts.push({ inlineData: { mimeType: imageFile.mimetype || 'image/jpeg', data: imageFile.buffer.toString('base64') } });
    if (textInput) parts.push({ text: textInput });

    const result = await model.generateContent(parts);
    const raw = (result.response.text() || '').trim();

    const parsed = safeParseJson(raw);
    if (!parsed) return res.status(502).json({ error: 'Could not parse response from AI engine.' });

    res.json(parsed);
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Server processing error.' });
  }
});

function safeParseJson(raw) {
  try { return JSON.parse(raw); } 
  catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

app.listen(PORT, () => console.log(`Mini AI running on port ${PORT}`));

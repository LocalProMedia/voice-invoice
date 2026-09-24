// server.js (Invoices, Marketing Intel, and Conversational Search with Offline Fallback)
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
    console.error('License verification error:', err);
    return false;
  }
}

app.post('/api/generate-quote', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]), async (req, res) => {
  try {
    const licenseKey = req.headers['x-license-key'];
    const isValidLicense = await verifyGumroadLicense(licenseKey);

    if (!isValidLicense) {
      return res.status(401).json({ error: 'Active Gumroad license or TEST-MODE required.' });
    }

    const textInput = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
    const trade = req.body && req.body.trade ? req.body.trade : 'General Contractor';
    const actionType = req.body && req.body.actionType ? req.body.actionType : 'quote'; 
    const audioFile = req.files && req.files['audio'] ? req.files['audio'][0] : null;
    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;

    if (!audioFile && !imageFile && !textInput) {
      return res.status(400).json({ error: 'Please provide text, audio, or a photo/screenshot.' });
    }

    let systemInstruction = "";
    let responseMimeType = "application/json";

    if (actionType === 'chat') {
      responseMimeType = "text/plain";
      systemInstruction = `
You are a knowledgeable, direct field assistant for independent ${trade} contractors.
Answer questions directly using real-time search when needed for local building codes, trade specifications, troubleshooting, or live pricing.
Keep explanations concise, practical, and tailored to working in the field.
      `.trim();
    } else if (actionType === 'marketing') {
      systemInstruction = `
You are a Growth Marketing & Reputation Intelligence Engine for home service professionals (${trade}).
Analyze the provided screenshot (Yelp page, social feed, reviews, or template library) and notes.

Produce an action plan strictly matching this JSON schema:
{
  "type": "marketing",
  "business_name": "Extracted business name or Valued Trade Pro",
  "audit_findings": [
    "Key observation about Yelp profile, ratings, missing details, or template layout"
  ],
  "social_templates": [
    {
      "platform": "Instagram / Facebook / Nextdoor",
      "hook": "Attention-grabbing headline",
      "caption": "Full post copy matching high-ticket ${trade} work",
      "call_to_action": "Contact link or direct dial recommendation",
      "suggested_visual": "Photo or template layout recommendation"
    }
  ]
}
      `.trim();
    } else {
      systemInstruction = `
You are an AI estimating engine for home service professionals specializing in: ${trade}.
Extract the client name, job address, and itemized billing details into clean line items.
If prices or materials are not stated, use Google Search grounding to populate accurate market rates.

Produce an invoice strictly matching this JSON schema:
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
      generationConfig: { responseMimeType, temperature: 0.2 },
    });

    const parts = [];
    if (audioFile) parts.push({ inlineData: { mimeType: audioFile.mimetype || 'audio/webm', data: audioFile.buffer.toString('base64') } });
    if (imageFile) parts.push({ inlineData: { mimeType: imageFile.mimetype || 'image/jpeg', data: imageFile.buffer.toString('base64') } });
    if (textInput) parts.push({ text: textInput });

    try {
      const result = await model.generateContent(parts);
      const raw = (result.response.text() || '').trim();

      if (actionType === 'chat') {
        return res.json({ type: "chat", reply: raw });
      }

      const parsed = safeParseJson(raw);
      if (!parsed) throw new Error('Unparseable AI response');
      return res.json(parsed);

    } catch (geminiError) {
      console.warn("Gemini API fallback active:", geminiError.message);

      if (actionType === 'chat') {
        return res.json({
          type: "chat",
          reply: `Offline Mode: Unable to connect to Gemini live search right now. If you need standard diagnostic rates or basic quotes, switch over to Quote mode to calculate with saved presets.`
        });
      }

      if (actionType === 'marketing') {
        return res.json({
          type: "marketing",
          business_name: "Local Offline Mode",
          audit_findings: ["AI is temporarily offline. Basic templates generated from local presets."],
          social_templates: [{
            platform: "Universal",
            hook: `Need a reliable ${trade}?`,
            caption: `We are currently booking projects for the upcoming week! Contact us today to secure a spot on the calendar.`,
            call_to_action: "Send us a direct message!",
            suggested_visual: "A high-quality before-and-after photo of your most recent job."
          }]
        });
      }

      const priceMatch = textInput.match(/\$?(\d+(\.\d{2})?)/);
      const rate = priceMatch ? parseFloat(priceMatch[1]) : 0;
      const desc = textInput.trim() || `Standard ${trade} Service`;

      return res.json({
        type: "quote",
        client_name: "Client Quote (Offline Mode)",
        address: "",
        line_items: [
          { 
            description: rate > 0 ? desc : `Standard Service Call (${trade})`, 
            quantity: 1, 
            rate: rate > 0 ? rate : 125 
          }
        ]
      });
    }

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

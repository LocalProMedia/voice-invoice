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

// No license check of any kind in this file. Access is controlled by the
// password screen in index.html for now, while Gumroad isn't wired up yet.

const QUOTE_SCHEMA_INSTRUCTIONS = (trade) => `
You are an expert estimating engine for a ${trade} contractor's voice-to-invoice tool.

You will receive audio, an image, and/or text describing a job. Extract the
facts and return RAW JSON ONLY — no markdown fences, no commentary.

Return JSON matching exactly this shape:
{
  "type": "quote",
  "client_name": "",
  "address": "",
  "line_items": [ { "description": "", "quantity": 1, "rate": 0 } ]
}

Rules:
- "client_name"/"address": if not stated, use "".
- "line_items": at least one entry if any work is described.
- "quantity": default 1. "rate": plain number, no currency symbols, 0 if unstated.
- Never invent a name, address, or price that wasn't stated.
`.trim();

const CHAT_INSTRUCTIONS = (trade) => `
You are a knowledgeable, direct field assistant for independent ${trade} contractors.
Answer questions about codes, specs, troubleshooting, or pricing — concisely and practically.
Respond in plain text, not JSON.
`.trim();

const MARKETING_SCHEMA_INSTRUCTIONS = (trade) => `
You are a growth marketing engine for a ${trade} contractor. Analyze the provided
screenshot (a review site, social profile, or post) and any notes. Return RAW
JSON ONLY matching exactly this shape:
{
  "type": "marketing",
  "business_name": "",
  "audit_findings": ["short observation", "short observation"],
  "social_templates": [
    { "platform": "", "hook": "", "caption": "", "call_to_action": "", "suggested_visual": "" }
  ]
}
Base findings and suggestions only on what's actually visible in the image/notes provided.
`.trim();

app.post(
  '/api/generate-quote',
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]),
  async (req, res) => {
    try {
      const textInput = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
      const trade = (req.body && req.body.trade) ? req.body.trade : 'General Contractor';
      const actionType = (req.body && req.body.actionType) ? req.body.actionType : 'quote';
      const audioFile = req.files && req.files['audio'] ? req.files['audio'][0] : null;
      const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;

      if (!audioFile && !imageFile && !textInput) {
        return res.status(400).json({ error: 'Please provide text, audio, or a screenshot.' });
      }

      let systemInstruction;
      let responseMimeType = 'application/json';
      if (actionType === 'chat') {
        systemInstruction = CHAT_INSTRUCTIONS(trade);
        responseMimeType = 'text/plain';
      } else if (actionType === 'marketing') {
        systemInstruction = MARKETING_SCHEMA_INSTRUCTIONS(trade);
      } else {
        systemInstruction = QUOTE_SCHEMA_INSTRUCTIONS(trade);
      }

      const model = genAI.getGenerativeModel({
        model: 'gemini-3.5-flash-lite',
        systemInstruction,
        generationConfig: { responseMimeType, temperature: 0.2 },
      });

      const parts = [];
      if (audioFile) {
        parts.push({ inlineData: { mimeType: audioFile.mimetype || 'audio/webm', data: audioFile.buffer.toString('base64') } });
      }
      if (imageFile) {
        parts.push({ inlineData: { mimeType: imageFile.mimetype || 'image/jpeg', data: imageFile.buffer.toString('base64') } });
      }
      if (textInput) {
        parts.push({ text: textInput });
      }

      const result = await model.generateContent(parts);
      const raw = (result.response.text() || '').trim();

      if (actionType === 'chat') {
        return res.json({ type: 'chat', reply: raw });
      }

      const parsed = safeParseJson(raw);
      if (!parsed) {
        console.error('Gemini returned unparseable output:', raw);
        return res.status(502).json({ error: 'The AI response could not be parsed. Please try again.' });
      }

      if (actionType === 'marketing') {
        return res.json(normalizeMarketing(parsed));
      }
      return res.json(normalizeInvoice(parsed));

    } catch (err) {
      console.error('generate-quote error:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  }
);

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_) { return null; }
    }
    return null;
  }
}

function normalizeInvoice(parsed) {
  const lineItems = Array.isArray(parsed.line_items) ? parsed.line_items : [];
  return {
    type: 'quote',
    client_name: typeof parsed.client_name === 'string' ? parsed.client_name : '',
    address: typeof parsed.address === 'string' ? parsed.address : '',
    line_items: lineItems.map((li) => ({
      description: typeof li.description === 'string' ? li.description : '',
      quantity: Number.isFinite(Number(li.quantity)) && Number(li.quantity) > 0 ? Number(li.quantity) : 1,
      rate: Number.isFinite(Number(li.rate)) && Number(li.rate) >= 0 ? Number(li.rate) : 0,
    })),
  };
}

function normalizeMarketing(parsed) {
  const templates = Array.isArray(parsed.social_templates) ? parsed.social_templates : [];
  return {
    type: 'marketing',
    business_name: typeof parsed.business_name === 'string' ? parsed.business_name : '',
    audit_findings: Array.isArray(parsed.audit_findings) ? parsed.audit_findings.filter((f) => typeof f === 'string') : [],
    social_templates: templates.map((t) => ({
      platform: typeof t.platform === 'string' ? t.platform : '',
      hook: typeof t.hook === 'string' ? t.hook : '',
      caption: typeof t.caption === 'string' ? t.caption : '',
      call_to_action: typeof t.call_to_action === 'string' ? t.call_to_action : '',
      suggested_visual: typeof t.suggested_visual === 'string' ? t.suggested_visual : '',
    })),
  };
}

app.listen(PORT, () => console.log('Voice-to-Invoice server running on port ' + PORT));

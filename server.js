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

// ---- Real trade knowledge, so quotes reflect how each trade actually works ----
const TRADE_KNOWLEDGE = {
  'Home Cleaning': `
Common services: standard cleaning, deep cleaning, move-in/move-out cleaning,
recurring cleaning (weekly/biweekly/monthly), window cleaning, carpet cleaning,
post-construction cleaning.
Typical pricing basis: flat rate by home size (studio/1BR/2BR/3BR+) or hourly
rate per cleaner. Deep cleans and move-out cleans typically cost more than
standard recurring visits. Recurring plans are often discounted vs one-time.`,
  'Plumbing': `
Common services: leak repair, drain cleaning/snaking, water heater install or
repair, toilet/faucet install or repair, pipe repair or repiping, sump pump
service, garbage disposal install, emergency/after-hours calls.
Typical pricing basis: flat rate per job or hourly with a service call/trip
fee. Emergency and after-hours calls typically cost more than scheduled work.
Parts (water heaters, fixtures) are usually billed separately from labor.`,
  'Electrical': `
Common services: panel upgrades, outlet/switch install or repair, lighting
install, ceiling fan install, EV charger install, whole-home rewiring, code
compliance/safety inspections, generator hookups.
Typical pricing basis: flat rate per fixture/outlet for small jobs, or by the
hour plus materials for larger jobs like panel upgrades or rewiring. Permit
fees may apply for panel work and are often billed separately.`,
  'Landscaping': `
Common services: lawn mowing/maintenance (recurring), mulching, planting,
irrigation install or repair, tree trimming/removal, hardscaping (patios,
walkways), seasonal cleanup (spring/fall).
Typical pricing basis: recurring lawn care is usually priced per visit or
monthly; one-time projects (hardscaping, tree work, irrigation) are priced
per job based on materials and labor.`,
  'Flooring': `
Common services: hardwood install or refinishing, laminate/vinyl plank
install, tile install, carpet install or replacement, subfloor repair,
flooring removal/haul-away.
Typical pricing basis: usually priced per square foot for material + install,
with removal/haul-away and subfloor repair billed as separate line items when
needed.`,
};

function tradeContext(trade) {
  return TRADE_KNOWLEDGE[trade] || '';
}

const QUOTE_SCHEMA_INSTRUCTIONS = (trade) => `
You are an expert estimating engine for a ${trade} contractor's voice-to-invoice tool.

What you know about this trade:
${tradeContext(trade) || `No specific reference data for "${trade}" — use general contractor knowledge.`}

You will receive audio, an image, and/or text describing a job, possibly across
several messages in a conversation. Use the full conversation so far to decide
what you already know and what's still missing.

Return RAW JSON ONLY — no markdown fences, no commentary. Choose ONE of two shapes:

If you have enough to produce a reasonable quote (address and at least one
job/service IS required to quote confidently; client name is not required):
{
  "type": "quote",
  "client_name": "",
  "address": "",
  "line_items": [ { "description": "", "quantity": 1, "rate": 0 } ]
}

If key details are missing (e.g. no address, no clear scope of work, ambiguous
job size), DO NOT guess or invent them. Instead ask ONE short, specific
follow-up question:
{
  "type": "question",
  "question": ""
}

Rules:
- Prefer asking a question over inventing an address, price, or scope that
  was never stated.
- "quantity": default 1. "rate": plain number, no currency symbols — use your
  trade knowledge above to suggest a realistic market rate if the contractor
  didn't state one, rather than defaulting to 0.
- Never invent a client name — leave it "" if not stated, that's fine.
`.trim();

const CHAT_INSTRUCTIONS = (trade) => `
You are a knowledgeable, direct field assistant for independent ${trade} contractors.

What you know about this trade:
${tradeContext(trade) || `No specific reference data for "${trade}" — use general contractor knowledge.`}

Answer questions about codes, specs, troubleshooting, or pricing — concisely
and practically, using the conversation so far for context.

If the question is too vague or broad to give a genuinely specific, useful
answer (not enough detail to know what's actually being asked), do not give a
generic non-answer. Instead, ask ONE short clarifying question to get the
detail you need — then answer properly once you have it.

Respond in plain text, not JSON, whether you're answering or asking.
`.trim();

const MARKETING_SCHEMA_INSTRUCTIONS = (trade) => `
You are a growth marketing engine for a ${trade} contractor. Analyze the provided
screenshot (a review site, social profile, or post) and any notes.

Return RAW JSON ONLY. Choose ONE of two shapes:

If the screenshot/notes give you enough to actually say something specific and
useful (not just generic filler):
{
  "type": "marketing",
  "business_name": "",
  "audit_findings": ["short observation", "short observation"],
  "social_templates": [
    { "platform": "", "hook": "", "caption": "", "call_to_action": "", "suggested_visual": "" }
  ]
}

If the image is blank, unreadable, unrelated to the business, or there's not
enough there to say anything specific — do not force a generic audit. Instead:
{
  "type": "question",
  "question": ""
}

Base findings and suggestions only on what's actually visible in the image/notes provided.
`.trim();

const REPLY_SCHEMA_INSTRUCTIONS = (trade) => `
You are a customer-communications assistant for a ${trade} contractor.

What you know about this trade:
${tradeContext(trade) || `No specific reference data for "${trade}" — use general contractor knowledge.`}

You will be given a message a CUSTOMER sent to the contractor (a text, email,
DM, or review). Draft a warm, professional, concise reply the contractor can
send back as-is.

If the customer asks about pricing and gave enough detail to ballpark it,
use your trade knowledge above to give a rough range rather than refusing to
mention price. If there's not enough detail to even ballpark, the reply
should ask the customer for the specific missing detail (e.g. square footage,
address, what exactly needs doing) rather than being vague.

Return RAW JSON ONLY matching exactly this shape:
{
  "type": "reply",
  "reply_text": ""
}
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

      // Conversation memory: the frontend sends prior turns as a JSON array
      // of { role: 'user' | 'model', text: '...' }. This is what lets the
      // assistant ask a follow-up question and then actually use the answer.
      let history = [];
      if (req.body && typeof req.body.history === 'string' && req.body.history.trim()) {
        try {
          const parsedHistory = JSON.parse(req.body.history);
          if (Array.isArray(parsedHistory)) {
            history = parsedHistory.filter(
              (h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string'
            );
          }
        } catch (_) {
          history = [];
        }
      }

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
      } else if (actionType === 'reply') {
        systemInstruction = REPLY_SCHEMA_INSTRUCTIONS(trade);
      } else {
        systemInstruction = QUOTE_SCHEMA_INSTRUCTIONS(trade);
      }

      const model = genAI.getGenerativeModel({
        model: 'gemini-3.5-flash-lite',
        systemInstruction,
        generationConfig: { responseMimeType, temperature: 0.2 },
      });

      // Build the current turn's parts (audio/image/text).
      const currentParts = [];
      if (audioFile) {
        currentParts.push({ inlineData: { mimeType: audioFile.mimetype || 'audio/webm', data: audioFile.buffer.toString('base64') } });
      }
      if (imageFile) {
        currentParts.push({ inlineData: { mimeType: imageFile.mimetype || 'image/jpeg', data: imageFile.buffer.toString('base64') } });
      }
      if (textInput) {
        currentParts.push({ text: textInput });
      }
      if (currentParts.length === 0) {
        currentParts.push({ text: '(no additional input)' });
      }

      // Full conversation: prior turns (text-only, that's all we keep) + this turn.
      const contents = history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      }));
      contents.push({ role: 'user', parts: currentParts });

      const result = await model.generateContent({ contents });
      const raw = (result.response.text() || '').trim();

      if (actionType === 'chat') {
        return res.json({ type: 'chat', reply: raw });
      }

      const parsed = safeParseJson(raw);
      if (!parsed) {
        console.error('Gemini returned unparseable output:', raw);
        return res.status(502).json({ error: 'The AI response could not be parsed. Please try again.' });
      }

      // Check for a clarifying question FIRST, regardless of mode — both
      // Quote and Marketing can ask one instead of forcing a weak answer.
      if (parsed.type === 'question') {
        const question = typeof parsed.question === 'string' && parsed.question.trim()
          ? parsed.question.trim()
          : 'Can you give me a bit more detail?';
        return res.json({ type: 'question', question });
      }

      if (actionType === 'marketing') {
        return res.json(normalizeMarketing(parsed));
      }

      if (actionType === 'reply') {
        const replyText = typeof parsed.reply_text === 'string' && parsed.reply_text.trim()
          ? parsed.reply_text.trim()
          : "Thanks for reaching out — could you share a bit more detail so I can get you an accurate answer?";
        return res.json({ type: 'reply', reply_text: replyText });
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

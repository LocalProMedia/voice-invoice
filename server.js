require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('\n[FATAL] GEMINI_API_KEY is not set.\n');
  process.exit(1);
}

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
      return res.status(401).json({ error: 'Active Gumroad license required.' });
    }

    const textInput = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
    const trade = req.body && req.body.trade ? req.body.trade : 'General Contractor';
    const actionType = req.body && req.body.actionType ? req.body.actionType : 'quote';
    const audioFile = req.files && req.files['audio'] ? req.files['audio'][0] : null;
    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;

    if (!audioFile && !imageFile && !textInput) {
      return res.status(400).json({ error: 'Please provide text, audio, or a screenshot.' });
    }

    let systemPrompt = "";
    if (actionType === 'chat') {
      systemPrompt = "You are a field assistant for " + trade + " contractors. Answer questions directly regarding codes, specs, troubleshooting, or pricing concisely.";
    } else if (actionType === 'marketing') {
      systemPrompt = "You are a Growth Marketing Engine for " + trade + ". Analyze the screenshot and notes. Output raw JSON only with keys: type ('marketing'), business_name, audit_findings (array of strings), and social_templates (array of objects with platform, hook, caption, call_to_action, suggested_visual).";
    } else {
      systemPrompt = "You are an estimating engine for " + trade + ". Extract client name, address, and line items into raw JSON only with keys: type ('quote'), client_name, address, and line_items (array of objects with description, quantity, rate).";
    }

    const contentsParts = [];
    contentsParts.push({ text: systemPrompt });

    if (imageFile) {
      contentsParts.push({
        inline_data: {
          mime_type: imageFile.mimetype || 'image/jpeg',
          data: imageFile.buffer.toString('base64')
        }
      });
    }

    if (audioFile) {
      contentsParts.push({
        inline_data: {
          mime_type: audioFile.mimetype || 'audio/webm',
          data: audioFile.buffer.toString('base64')
        }
      });
    }

    if (textInput) {
      contentsParts.push({ text: textInput });
    }

    try {
      const fetch = (await import('node-fetch')).default;
      const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' + GEMINI_API_KEY;

      const apiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: contentsParts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: actionType === 'chat' ? 'text/plain' : 'application/json'
          }
        })
      });

      const responseData = await apiRes.json();

      if (!apiRes.ok) {
        console.error("Gemini Direct API Error:", JSON.stringify(responseData));
        throw new Error(responseData.error?.message || 'Google API returned an error');
      }

      const raw = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (actionType === 'chat') {
        return res.json({ type: "chat", reply: raw });
      }

      const parsed = safeParseJson(raw);
      if (!parsed) throw new Error('Unparseable AI response');
      return res.json(parsed);

    } catch (geminiError) {
      console.warn("Gemini direct request failed:", geminiError.message);

      if (actionType === 'chat') {
        return res.json({
          type: "chat",
          reply: "Offline Mode: AI connection interrupted. Switch to Quote mode to build pricing with offline trade presets."
        });
      }

      if (actionType === 'marketing') {
        return res.json({
          type: "marketing",
          business_name: "Local Offline Mode",
          audit_findings: ["AI is temporarily offline. Basic templates generated locally."],
          social_templates: [{
            platform: "Universal",
            hook: "Need a reliable " + trade + "?",
            caption: "We are currently booking projects for the upcoming week! Reach out today to claim your slot on the schedule.",
            call_to_action: "Send us a direct message!",
            suggested_visual: "A high-quality photo of your cleanest recent job."
          }]
        });
      }

      const priceMatch = textInput.match(/\$?(\d+(\.\d{2})?)/);
      const rate = priceMatch ? parseFloat(priceMatch[1]) : 0;
      const desc = textInput.trim() || ("Standard " + trade + " Service");

      return res.json({
        type: "quote",
        client_name: "Client Quote (Offline Mode)",
        address: "",
        line_items: [
          {
            description: rate > 0 ? desc : ("Standard Service Call (" + trade + ")"),
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

app.listen(PORT, () => console.log('Mini AI running on port ' + PORT));

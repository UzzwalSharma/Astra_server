import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import { StreamChat } from "stream-chat";
import axios from "axios";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Stream Admin Client
const serverClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET
);


// Token endpoint for connecting users
app.get("/token/:userId", async (req, res) => {
  const { userId } = req.params;
  const { name } = req.query;

  if (!userId || !name) return res.status(400).json({ error: "userId and name are required" });

  try {
    await serverClient.upsertUser({ id: userId, name });

    const channel = serverClient.channel("messaging", "astra-support", {
      name: "Astra Support",
      members: [userId],
    });
    await channel.create({ created_by_id: "admin", exists: true });
    await channel.addMembers([userId]);

    const token = serverClient.createToken(userId);
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Truncate channel (admin-only)
app.post("/truncate-channel", async (req, res) => {
  try {
    const channel = serverClient.channel("messaging", "astra-support");
    await channel.truncate(); // admin API key bypasses permissions
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


//reverse search
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SEARCH_ENGINE_ID = process.env.GOOGLE_CX;

app.get("/leaders", async (req, res) => {
  const { district, state } = req.query;
  if (!district || !state) return res.status(400).json({ error: "district and state required" });

  try {
    // Example queries
    const queries = [
      `MLA of ${district} ${state}`,
      `MP of ${district} ${state}`,
      `Nagar Palika Adhyaksh of ${district} ${state}`
    ];

    const results = {};

    for (let q of queries) {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(q)}&key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}`;
      const { data } = await axios.get(url);

      if (data.items && data.items.length > 0) {
        results[q] = {
          title: data.items[0].title,
          // snippet: data.items[0].snippet,
          link: data.items[0].link,
          
        };
      } else {
        results[q] = { error: "No results" };
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leaders from Google" });
  }
});

//Gemini endpoint 

// helper to convert image URL → base64
async function fetchImageAsBase64(imageUrl) {
  const res = await fetch(imageUrl);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

app.post("/gemini", async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });

  try {
    // ---- STEP 1: Fetch + Encode Image ----
    const base64 = await fetchImageAsBase64(imageUrl);
    console.log("Base64 length:", base64.length);

    // ---- STEP 2: Ask Gemini to Describe ----
    const PROMPT_DESCRIBE = "Describe what is visible in this image in 1-2 sentences.";
    const describeResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT_DESCRIBE },
                {
                  inlineData: {
                    mimeType: getMimeType(imageUrl),
                    data: base64,
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    const describeData = await describeResp.json();
    const descriptionText =
      describeData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Step 1 - Description:", descriptionText);

    // ---- STEP 3: Ask Gemini to Classify ----
    const PROMPT_CLASSIFY = `You are classifying emergency reports.
Based on this description: "${descriptionText}"

Classify strictly in this format:
TITLE: short emergency title OR "SPAM"
TYPE: (Theft, Harassment, Accident, Violence, Bullying, Garbage, Fire outbreak, Water Leakage, Other, SPAM)
DESCRIPTION: concise description OR "SPAM"

If the description clearly relates to emergencies (fire, garbage, accident, etc.) classify accordingly.
If unrelated, output SPAM.`;

    const classifyResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT_CLASSIFY }] }],
        }),
      }
    );

    const classifyData = await classifyResp.json();
    console.log("Step 2 - Raw classify:", JSON.stringify(classifyData, null, 2));

    const text =
      classifyData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "TITLE: SPAM\nTYPE: SPAM\nDESCRIPTION: SPAM";

    // ---- STEP 4: Parse structured fields ----
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let title = "", type = "", description = "";
    for (const line of lines) {
      if (line.toUpperCase().startsWith("TITLE:")) title = line.replace(/TITLE:\s*/i, "");
      if (line.toUpperCase().startsWith("TYPE:")) type = line.replace(/TYPE:\s*/i, "");
      if (line.toUpperCase().startsWith("DESCRIPTION:")) description = line.replace(/DESCRIPTION:\s*/i, "");
    }

    // Fallback to SPAM if not classified properly
    if (!title || !type || !description) {
      return res.json({ title: "SPAM", type: "SPAM", description: "SPAM" });
    }

    res.json({ title, type, description });
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "Failed to call Gemini API" });
  }
});


function getMimeType(url) {
  if (/\.png($|\?)/i.test(url)) return "image/png";
  if (/\.webp($|\?)/i.test(url)) return "image/webp";
  if (/\.jpg($|\?|$)/i.test(url) || /\.jpeg($|\?)/i.test(url)) return "image/jpeg";
  return "image/jpeg";
}






app.listen(5000, () => console.log("Server running on http://localhost:5000"));

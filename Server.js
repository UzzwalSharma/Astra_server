import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import { StreamChat } from "stream-chat";

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

app.listen(5000, () => console.log("Server running on http://localhost:5000"));

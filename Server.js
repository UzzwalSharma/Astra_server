import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(bodyParser.json());

const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH;
const client = twilio(accountSid, authToken);
console.log(accountSid, authToken);
// API route
app.post("/send-message", async (req, res) => {
  try {
    const { to, message } = req.body;

    const result = await client.messages.create({
      from: process.env.TWILIO_NUMBER, // your Twilio phone number
      to,
      body: message,
    });

    res.json({ success: true, sid: result.sid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));

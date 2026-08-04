import { Router } from "express";
import { TUTOR_INSTRUCTIONS } from "../prompts.js";

const REALTIME_MODEL = "gpt-realtime-2.1";
const VOICE = "marin";

export const sessionRouter = Router();

sessionRouter.post("/realtime-session", async (_req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: TUTOR_INSTRUCTIONS,
          audio: {
            output: { voice: VOICE },
            input: { transcription: { model: "whisper-1" } },
          },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      res.status(response.status).json({ error: "Failed to create realtime session", detail });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Unexpected error creating realtime session", detail: String(err) });
  }
});

import { Router } from "express";
import { TUTOR_REMINDER } from "../prompts.js";

const SUMMARY_MODEL = "gpt-5.4-mini";

const SUMMARIZER_SYSTEM_PROMPT = `You summarize a spoken English-practice conversation between a tutor (assistant) and a learner (user). Write a concise English summary (a few sentences) covering: topics discussed, and any recurring grammar/word-choice mistakes the learner made. Write only the summary, in English, no preamble.`;

export const summarizeRouter = Router();

summarizeRouter.post("/summarize", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    return;
  }

  const text = req.body?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Missing or empty 'text' in request body" });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SUMMARIZER_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      res.status(response.status).json({ error: "Failed to summarize conversation", detail });
      return;
    }

    const data = await response.json();
    const summary: string = data.choices?.[0]?.message?.content?.trim() ?? "";

    res.json({ systemMessage: `${TUTOR_REMINDER}\n\nContext so far: ${summary}` });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error summarizing conversation", detail: String(err) });
  }
});

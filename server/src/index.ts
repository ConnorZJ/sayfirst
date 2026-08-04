import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { sessionRouter } from "./routes/session.js";
import { summarizeRouter } from "./routes/summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());
app.use("/api", sessionRouter);
app.use("/api", summarizeRouter);

// In production the web app is prebuilt and served by this same process,
// so the frontend's relative /api requests are same-origin and need no proxy.
if (process.env.NODE_ENV === "production") {
  const webDist = path.join(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get(/(.*)/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`sayfirst server listening on http://localhost:${port}`);
});

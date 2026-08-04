import type { TranscriptItem } from "../useTranscript";

interface TranscriptProps {
  items: TranscriptItem[];
}

export function Transcript({ items }: TranscriptProps) {
  if (items.length === 0) {
    return <p className="transcript-empty">对话内容会显示在这里……</p>;
  }

  return (
    <div className="transcript">
      {items.map((item) => (
        <div key={item.id} className={`transcript-row ${item.role}`}>
          <span className="transcript-label">{item.role === "user" ? "你" : "AI"}</span>
          <p className="transcript-text">{item.text || "…"}</p>
        </div>
      ))}
    </div>
  );
}

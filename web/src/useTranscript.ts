import { useCallback, useState } from "react";
import type { TranscriptEvent, TranscriptRole } from "./lib/realtime";

export interface TranscriptItem {
  id: string;
  role: TranscriptRole;
  text: string;
}

export function useTranscript() {
  const [items, setItems] = useState<TranscriptItem[]>([]);

  const handleEvent = useCallback((event: TranscriptEvent) => {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === event.id);

      if (event.kind === "delta") {
        if (index === -1) {
          return [...prev, { id: event.id, role: event.role, text: event.delta }];
        }
        const next = [...prev];
        next[index] = { ...next[index], text: next[index].text + event.delta };
        return next;
      }

      // final
      if (index === -1) {
        return [...prev, { id: event.id, role: event.role, text: event.text }];
      }
      const next = [...prev];
      next[index] = { ...next[index], text: event.text };
      return next;
    });
  }, []);

  const reset = useCallback(() => setItems([]), []);

  return { items, handleEvent, reset };
}

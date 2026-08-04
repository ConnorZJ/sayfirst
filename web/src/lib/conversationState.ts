export type TurnRole = "user" | "assistant";

interface Turn {
  itemId: string;
  role: TurnRole;
  text: string;
}

// Model context window is 128k tokens; this trigger is intentionally conservative
// so quality doesn't degrade well before the hard limit. Tune upward (e.g. 80k-100k)
// once real usage shows longer contexts still hold up fine.
const SUMMARY_TRIGGER_TOKENS = 30_000;

// Keep the most recent turns verbatim so the conversation still reads naturally.
const KEEP_LAST_TURNS = 6;

export type SendEvent = (event: Record<string, unknown>) => void;

export class ConversationTracker {
  private history: Turn[] = [];
  private summarizing = false;
  private summaryCount = 0;

  recordItemCreated(itemId: string, role: TurnRole) {
    if (this.history.some((turn) => turn.itemId === itemId)) return;
    this.history.push({ itemId, role, text: "" });
  }

  recordFinalText(itemId: string, role: TurnRole, text: string) {
    const turn = this.history.find((t) => t.itemId === itemId);
    if (turn) {
      turn.text = text;
    } else {
      this.history.push({ itemId, role, text });
    }
  }

  recordUsage(totalTokens: number, send: SendEvent) {
    if (totalTokens < SUMMARY_TRIGGER_TOKENS || this.summarizing) return;
    void this.summarize(send);
  }

  private async summarize(send: SendEvent) {
    const old = this.history.slice(0, -KEEP_LAST_TURNS).filter((t) => t.text);
    const recent = this.history.slice(-KEEP_LAST_TURNS);
    if (old.length === 0) return;

    this.summarizing = true;
    try {
      const text = old.map((t) => `${t.role}: ${t.text}`).join("\n");

      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        console.error("Context summarization failed:", await res.text());
        return;
      }

      const { systemMessage } = (await res.json()) as { systemMessage: string };

      this.summaryCount += 1;
      const summaryId = `sum_${this.summaryCount}`;

      send({
        type: "conversation.item.create",
        previous_item_id: "root",
        item: {
          id: summaryId,
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: systemMessage }],
        },
      });

      for (const turn of old) {
        send({ type: "conversation.item.delete", item_id: turn.itemId });
      }

      this.history = [{ itemId: summaryId, role: "assistant", text: systemMessage }, ...recent];
      console.debug(`[conversationState] summarized ${old.length} turns into ${summaryId}`);
    } catch (err) {
      console.error("Context summarization error:", err);
    } finally {
      this.summarizing = false;
    }
  }
}

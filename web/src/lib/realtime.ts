import { ConversationTracker, type SendEvent } from "./conversationState";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export type TranscriptRole = "user" | "assistant";

export type TranscriptEvent =
  | { kind: "delta"; id: string; role: TranscriptRole; delta: string }
  | { kind: "final"; id: string; role: TranscriptRole; text: string };

export interface RealtimeCallbacks {
  onStatusChange: (status: ConnectionStatus, detail?: string) => void;
  onTranscriptEvent: (event: TranscriptEvent) => void;
}

export interface RealtimeConnection {
  disconnect: () => void;
}

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export async function connectRealtime(callbacks: RealtimeCallbacks): Promise<RealtimeConnection> {
  callbacks.onStatusChange("connecting");

  const tokenRes = await fetch("/api/realtime-session", { method: "POST" });
  if (!tokenRes.ok) {
    throw new Error(`Failed to fetch ephemeral session token (${tokenRes.status})`);
  }
  const tokenData = await tokenRes.json();
  const ephemeralKey: string = tokenData.value;
  if (!ephemeralKey) {
    throw new Error("Ephemeral token missing from server response");
  }

  const pc = new RTCPeerConnection();

  const audioEl = new Audio();
  audioEl.autoplay = true;
  pc.ontrack = (event) => {
    audioEl.srcObject = event.streams[0];
  };

  const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

  const tracker = new ConversationTracker();
  const dataChannel = pc.createDataChannel("oai-events");
  const send: SendEvent = (obj) => {
    if (dataChannel.readyState === "open") dataChannel.send(JSON.stringify(obj));
  };
  dataChannel.addEventListener("message", (event) => {
    handleServerEvent(JSON.parse(event.data), callbacks, tracker, send);
  });

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") callbacks.onStatusChange("connected");
    else if (pc.connectionState === "failed") callbacks.onStatusChange("error", "连接中断");
    else if (pc.connectionState === "closed") callbacks.onStatusChange("closed");
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpResponse = await fetch(REALTIME_CALLS_URL, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      "Content-Type": "application/sdp",
    },
  });

  if (!sdpResponse.ok) {
    const detail = await sdpResponse.text();
    throw new Error(`Realtime handshake failed (${sdpResponse.status}): ${detail}`);
  }

  const answerSdp = await sdpResponse.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  const disconnect = () => {
    dataChannel.close();
    pc.getSenders().forEach((sender) => sender.track?.stop());
    micStream.getTracks().forEach((track) => track.stop());
    pc.close();
    audioEl.srcObject = null;
    callbacks.onStatusChange("closed");
  };

  return { disconnect };
}

function handleServerEvent(
  event: any,
  callbacks: RealtimeCallbacks,
  tracker: ConversationTracker,
  send: SendEvent,
) {
  switch (event.type) {
    case "conversation.item.created":
      if (event.item?.type === "message") {
        tracker.recordItemCreated(event.item.id, event.item.role);
      }
      break;
    case "response.output_audio_transcript.delta":
      callbacks.onTranscriptEvent({ kind: "delta", id: event.item_id, role: "assistant", delta: event.delta });
      break;
    case "response.output_audio_transcript.done":
      callbacks.onTranscriptEvent({ kind: "final", id: event.item_id, role: "assistant", text: event.transcript });
      tracker.recordFinalText(event.item_id, "assistant", event.transcript);
      break;
    case "conversation.item.input_audio_transcription.delta":
      callbacks.onTranscriptEvent({ kind: "delta", id: event.item_id, role: "user", delta: event.delta });
      break;
    case "conversation.item.input_audio_transcription.completed":
      callbacks.onTranscriptEvent({ kind: "final", id: event.item_id, role: "user", text: event.transcript });
      tracker.recordFinalText(event.item_id, "user", event.transcript);
      break;
    case "response.done":
      {
        const totalTokens = event.response?.usage?.total_tokens;
        if (typeof totalTokens === "number") {
          tracker.recordUsage(totalTokens, send);
        }
      }
      break;
    case "error":
      console.error("Realtime API error event:", event);
      break;
    default:
      break;
  }
}

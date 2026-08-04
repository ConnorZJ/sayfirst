import { useRef, useState } from "react";
import "./App.css";
import { Transcript } from "./components/Transcript";
import { connectRealtime, type ConnectionStatus, type RealtimeConnection } from "./lib/realtime";
import { useTranscript } from "./useTranscript";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  connected: "对话中",
  error: "出错了",
  closed: "已结束",
};

function App() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const { items, handleEvent, reset } = useTranscript();
  const connectionRef = useRef<RealtimeConnection | null>(null);

  const isActive = status === "connecting" || status === "connected";

  const start = async () => {
    setErrorDetail(null);
    reset();
    try {
      const connection = await connectRealtime({
        onStatusChange: (next, detail) => {
          setStatus(next);
          if (detail) setErrorDetail(detail);
        },
        onTranscriptEvent: handleEvent,
      });
      connectionRef.current = connection;
    } catch (err) {
      setStatus("error");
      setErrorDetail(err instanceof Error ? err.message : String(err));
    }
  };

  const stop = () => {
    connectionRef.current?.disconnect();
    connectionRef.current = null;
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>sayfirst</h1>
        <p className="subtitle">和 AI 实时对话，练习英语口语</p>
      </header>

      <main className="app-main">
        <div className="controls">
          <button
            type="button"
            className={`talk-button ${status}`}
            onClick={isActive ? stop : start}
          >
            {isActive ? "结束对话" : "开始对话"}
          </button>
          <span className={`status-pill ${status}`}>{STATUS_LABEL[status]}</span>
        </div>

        {errorDetail && <p className="error-detail">{errorDetail}</p>}

        <Transcript items={items} />
      </main>
    </div>
  );
}

export default App;

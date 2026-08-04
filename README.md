# sayfirst

一个基于 OpenAI Realtime API 的实时语音对话练习工具，帮助母语为中文的用户练习英语口语。打开网页、点击开始，就能和 AI 英语教练进行自然的语音对话——AI 会用英语对话，只在你出现明显语法/用词错误时用简短中文纠正一下，然后继续用英语聊。

## 功能

- **实时语音对话**：浏览器直接通过 WebRTC 连接 OpenAI Realtime API，低延迟语音交互
- **双语字幕**：对话过程中实时显示用户和 AI 双方的转写文字
- **长对话防漂移**：对话变长后自动触发摘要——把较早的对话内容压缩成摘要重新注入上下文，同时裁剪掉原始旧内容，避免过长对话导致 AI"忘记"自己是英语教练、逐渐切换回中文回复的问题

## 架构

```
web/     React + Vite 前端，浏览器直接建立 WebRTC 连接
server/  Express 后端，负责签发一次性 ephemeral token（不把真实 API key 暴露给浏览器）+ 对话摘要接口
```

前端不直接持有 OpenAI API key：每次开始对话时向后端请求一个短期有效的 ephemeral token，再用这个 token 建立 WebRTC 连接。摘要功能同理，压缩对话内容需要调用文本模型，这一步也经后端中转。

详细的技术方案见 [docs/realtime-context-summarization.md](docs/realtime-context-summarization.md)。

## 本地开发

需要 Node.js（建议 v20+）。

```bash
npm install
cp server/.env.example server/.env   # 填入你的 OPENAI_API_KEY
npm run dev
```

前端跑在 `http://localhost:5173`，后端跑在 `http://localhost:3001`，Vite dev server 会把 `/api` 请求代理到后端。

## 部署

部署到 Render 免费档的完整步骤见 [docs/deploy.md](docs/deploy.md)。生产模式下前后端合并成一个 Node 进程，后端顺带把前端构建产物 serve 掉。

## 技术栈

React 19、Vite、TypeScript、Express、OpenAI Realtime API（`gpt-realtime-2.1`）

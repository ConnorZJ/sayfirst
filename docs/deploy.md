# 部署到 Render（免费档）

sayfirst 现在是"一体化部署"：`server/` 在生产模式下会顺带把 `web/` 打包出的静态文件 serve 掉，前后端合并成一个 Node 进程、一个域名，前端请求 `/api/...` 天然同源，不需要处理跨域，也不需要额外的静态托管服务。

## 前提

- 一个 GitHub 仓库（把这个项目 push 上去）
- 一个 Render 账号（https://render.com，免费注册）
- 你自己的 `OPENAI_API_KEY`

## 步骤

1. 登录 Render，点 **New +** → **Web Service**，选中这个项目的 GitHub 仓库
2. 填写配置：
   - **Root Directory**：留空（用仓库根目录，因为 build/start 脚本是在根 `package.json` 里）
   - **Build Command**：`npm install && npm run build`
   - **Start Command**：`npm start`
   - **Environment**：Node
3. 在 **Environment Variables** 里添加：
   - `OPENAI_API_KEY` = 你的真实 key
   - `NODE_ENV` = `production`（触发 `server/src/index.ts` 里的静态文件 serve 逻辑）
   - `PORT` 不用手动填，Render 会自动注入，`server/src/index.ts` 已经读的是 `process.env.PORT`
4. 选免费档（Free），点 **Create Web Service**

Render 会自动跑一遍 `npm install && npm run build`（依次构建 `web` 和 `server` 两个 workspace），再执行 `npm start`（等价于 `npm run start -w server`，跑 `server/dist/index.js`）。构建成功后会给你一个 `https://xxx.onrender.com` 域名，直接打开就是完整的 app。

免费档的限制：闲置一段时间后服务会休眠，下次访问要等几秒钟冷启动，个人练习用完全够用；如果之后要长期稳定用，可以升级到付费档。

## 本地验证过生产模式

部署前可以在本地先验证一遍构建产物是否正常：

```bash
npm run build
NODE_ENV=production PORT=3002 npm run start -w server
# 另开一个终端
curl http://localhost:3002/                # 应该返回打包后的 index.html
curl -X POST http://localhost:3002/api/summarize -d '{}'  # 应该返回 500 + OPENAI_API_KEY 相关报错（本地没配 key 是正常的）
```

## 关于 Realtime API 的浏览器麦克风权限

WebRTC 的 `getUserMedia`（麦克风采集）要求页面是 HTTPS（或 `localhost`）才允许调用，Render 默认域名自带 HTTPS，这块不需要额外配置。

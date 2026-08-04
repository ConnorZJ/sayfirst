# Realtime API 长对话上下文摘要（翻译 + 项目落地笔记）

> 来源（英文原文）：
> - 官方 Cookbook 文章：<https://developers.openai.com/cookbook/examples/context_summarization_with_realtime_api>
> - 对应 Notebook 源码：<https://github.com/openai/openai-cookbook/blob/main/examples/Context_summarization_with_realtime_api.ipynb>
>
> 本文是对上述内容的翻译整理，并补充了对 `sayfirst` 项目的落地建议（见文末）。

## 这篇文章讲了什么

这是 OpenAI 官方 Cookbook 里的一个教程，教你用 Realtime API 做一个语音机器人：能听麦克风、能实时语音回复，并且在对话变长时**自动把旧的对话内容压缩成摘要**，防止对话质量随时间下降。

四个核心能力：
1. 把麦克风音频实时流式发给 Realtime 接口
2. 边说边出转写文字 + 语音播放
3. 维护一个"对话状态"，记录所有 user/assistant 消息
4. 当 token 用量变大时，自动把旧的对话轮次"压缩成一段摘要"，做上下文裁剪

## 为什么需要这个：语音比文字更"吃" token

原文有一句话很关键：

> gpt-realtime 支持 32k token 的上下文窗口，但在某些场景下，随着塞进上下文的 token 越来越多，你可能会注意到效果开始下降。

而且语音本身比文字消耗 token 要多得多——因为音频要表达音量、时长等声学细节，同一句话，音频形式消耗的 token 大概是纯文字形式的 **10 倍左右**。也就是说，语音对话"吃"上下文窗口的速度比纯文字对话快得多，长时间语音聊天更容易撞到上下文上限或者出现效果下降（这也是我们之前聊到的"指令漂移"背后的部分原因）。

> 注：原文写的是 `gpt-realtime`（32k 上下文）。我们项目用的 `gpt-realtime-2.1` 上下文窗口已经扩到 128k，撞上限的风险更低，但"越塞越多、旧指令占比被稀释"的问题本质上还是存在的，只是发生得更晚。

## 核心数据结构

```python
@dataclass
class Turn:
    """一句话（用户说的，或者 AI 说的）"""
    role: Literal["user", "assistant"]
    item_id: str                    # 服务端分配的 ID
    text: str | None = None         # 转写文字，转写完成后才会填上

@dataclass
class ConversationState:
    """维护整个会话所需的全部可变状态，只保留必要的字段"""
    history: List[Turn] = field(default_factory=list)         # 按顺序记录的对话历史
    waiting: dict[str, asyncio.Future] = field(default_factory=dict)
    summary_count: int = 0
    latest_tokens: int = 0          # 上一次回复后的上下文窗口大小
    summarising: bool = False       # 加锁，防止同时跑两个摘要任务
```

## 摘要触发的阈值配置

```python
SUMMARY_TRIGGER   = 2_000    # 上下文 token 数达到这个值就触发摘要（demo 用的小值，方便快速看到效果）
KEEP_LAST_TURNS   = 2        # 最近这几轮对话保持原样，不参与摘要
SUMMARY_MODEL     = "gpt-4o-mini"  # 用一个便宜、快的模型来做摘要，不需要用语音模型本身
```

生产环境建议：这个 demo 用 2000 token 是为了方便演示效果，实际部署时应该把 `SUMMARY_TRIGGER` 调到 **20,000～32,000 token** 之间，具体取决于你对质量的要求和场景特点。

## 生成摘要 + 插入对话

```python
async def run_summary_llm(text: str) -> str:
    """调一个轻量模型，把 text 总结成一段话"""
    resp = await asyncio.to_thread(lambda: openai.chat.completions.create(
        model=SUMMARY_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": "把下面的对话总结成一段简洁的话，"
                            "以便后续对话把它当作上下文使用。"},
            {"role": "user", "content": text},
        ],
    ))
    return resp.choices[0].message.content.strip()
```

**这里有一个很关键的设计细节**，原文特别强调了：

> 摘要是作为 **SYSTEM 角色**的消息插入的，而不是 ASSISTANT 角色。测试发现，在长对话里，如果用 ASSISTANT 消息来存摘要，可能会误导模型把"语音回复"错误地切换成"文字回复"。用 SYSTEM 消息（还可以顺带带上额外的自定义指令）能清楚地告诉模型：这只是设定上下文用的，不是真的对话内容。

这一点对我们项目也有直接参考价值——如果以后要重新注入 instructions 或摘要，角色应该用 `system`，不要用 `assistant`，避免模型混淆"这是我说过的话"和"这是背景设定"。

## 裁剪旧对话 + 用摘要替换

```python
async def summarise_and_prune(ws, state):
    """把旧的对话轮次总结掉，从服务端删除原始内容，
    本地和服务端都换成一条摘要 + 保留最近几轮原文"""
    state.summarising = True
    old_turns, recent_turns = state.history[:-KEEP_LAST_TURNS], state.history[-KEEP_LAST_TURNS:]
    convo_text = "\n".join(f"{t.role}: {t.text}" for t in old_turns if t.text)

    summary_text = await run_summary_llm(convo_text) if convo_text else ""
    state.summary_count += 1
    summary_id = f"sum_{state.summary_count:03d}"
    state.history[:] = [Turn("assistant", summary_id, summary_text)] + recent_turns

    # 在服务端创建这条摘要消息
    await ws.send(json.dumps({
        "type": "conversation.item.create",
        "previous_item_id": "root",
        "item": {
            "id": summary_id,
            "type": "message",
            "role": "system",
            "content": [{"type": "input_text", "text": summary_text}],
        },
    }))

    # 删掉被摘要掉的旧对话项
    for turn in old_turns:
        await ws.send(json.dumps({
            "type": "conversation.item.delete",
            "item_id": turn.item_id,
        }))
```

流程总结：监听每次 `response.done` 事件返回的 token 用量 → 达到阈值 → 把"最近几轮之前"的所有对话文本丢给一个便宜模型（`gpt-4o-mini`）做摘要 → 把摘要作为一条 `system` 消息插回对话 → 用 `conversation.item.delete` 把原始的旧对话项从服务端删掉，从而真正把上下文窗口"瘦身"下来。

## 实际应用场景（原文举例）

- 客服语音机器人：自动生成工单摘要
- 语言陪练：跟踪学习进度（**跟我们的场景高度相关**）
- 心理陪伴/教练类应用：保持长期会话的连续性
- 会议助手：自动生成行动项纪要

## 测试建议

- A/B 对比开启/关闭摘要功能的效果差异
- 尝试不同摘要格式（要点列表、JSON、不同语言）
- 调整触发阈值，观察效果
- 记录 token 消耗，做成本/效果的权衡分析

---

## 对 sayfirst 项目的落地建议

结合我们之前聊过的两个问题——**指令漂移**（长对话后 AI 忘记要用英语对话）和**要不要做记忆功能**——这篇文章其实同时给出了两者的技术基础：

1. **指令漂移问题**：目前我们计划的方案是"定时把 instructions 重新发一遍"，比较简单直接。这篇文章的摘要机制是更彻底的解法——不只是重复原始指令，而是把旧对话内容压缩掉、腾出上下文空间，同时保证摘要以 `system` 角色注入，不会污染模型对"该用什么语气/语言回复"的判断。如果未来发现单纯重发指令不够用（比如对话经常一聊就是半小时以上），可以考虑升级到这一套裁剪机制。目前阶段：**不需要立刻实现**，先用轻量方案，等真的遇到问题再引入。

2. **跨会话记忆功能**：这里的摘要逻辑（`run_summary_llm` + 把摘要存下来）本身就是"记忆"的雏形——差别只在于：这篇文章的摘要用完就存回当前这一次 Realtime 会话里，而"跨会话记忆"需要把摘要**持久化到本地存储**（比如 SQLite/JSON），下次开一个新会话时，把上次的摘要读出来塞进新 session 的 instructions 里。技术上是同一套"总结 + 注入"的模式，只是多了一层"存到磁盘、跨进程读取"的持久层。

3. **具体落地时可以复用的模式**（如果后面要做）：
   - 在 `server/` 端维护一个类似 `ConversationState` 的结构，跟踪当前会话的对话轮次和累计 token
   - 通过 data channel 监听 `response.done` 拿到 token 用量，达到阈值后调用一个便宜模型（如 `gpt-4o-mini`）做摘要
   - 摘要以 `role: "system"` 通过 `conversation.item.create` 插回去，旧的对话项用 `conversation.item.delete` 清掉
   - 如果要跨会话：摘要生成后额外写一份到本地文件/数据库，下次 `POST /api/realtime-session` 时把这份摘要拼进 `instructions` 里

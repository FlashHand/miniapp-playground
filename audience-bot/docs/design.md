# Audience BOT 设计

状态：v0.2.0，2026-11-08（v0.2.0：扩展随小程序安装、改名 audience-bot、监控面板、按标签页采音自检）；开发中：主播语音由 Dozin 内置识别、人格页显示语音模型状态（#8.2）。Audience BOT 是给 [Dozin](https://dozin.ai) 用的抖音直播间 AI 助手：弹幕和主播语音进入一个 Dozin 对话，对话里的 AI 按你写的人格回弹幕。它作为**外置**部件交付：不在 Dozin 的安装包里，每个部件单独安装，Dozin 只提供通用能力。

## #1 组成

| 部分 | 目录 | 做什么 | 装到哪里 |
|---|---|---|---|
| 扩展 `audience-bot` | `miniapp/extension/` | 在直播间标签页里收弹幕、读主播语音、发回复；注册一个带 `chat` 的 Gateway connector | `<home>/extensions/packages/audience-bot/`：安装小程序时一起装，再在 设置 › Extensions 批准、打开 |
| 小程序 `io.github.flashhand.audience-bot` | `miniapp/` | 人格页：编辑 `connectors/audience-bot/Agent.md`，提示也可以和 AI 聊天来改 | `<home>/miniapps/io.github.flashhand.audience-bot/<version_code>.asar` |
| 技能 `douyin-live-reply` | `skill/douyin-live-reply/` | 教 Dozin 的 AI 接管一个直播间：写 `target.json`、请人允许标签页、接入对话、写人格 | `<home>/skills/douyin-live-reply/`（`kit/install.sh` 安装） |
| 本机语音识别（旧方式） | `kit/` | macOS 采音 App（只采 Dozin 的应用音轨）+ whisper.cpp 识别桥，把主播的话写成 `continuous-state.json`。Dozin 支持 `transcribe` 后用 #8.2，不再需要它 | 运行目录 `~/.dozin-live-caption/` |
| 语音模型 | Dozin 的 `<home>/speech-models/` | Dozin 内置识别用的模型（默认 Qwen3-ASR 0.6B），技能按 Dozin 的下载约定从 OSS 下载 | 第一次要主播语音时下载 |

`<home>` 是 Dozin 的主目录：正式版 `~/.dozin`，Preview 版 `~/.dozin_preview`。

扩展里的文件：

```text
miniapp/extension/
  package.json   只有 name、dozin.capabilities ["browser"]、dozin.origins ["https://live.douyin.com"]
  index.mjs      activate(dozin)：registerConnector({ systemPrompt, chat, start, stop, send })
  room.mjs       注入直播间页面的三个 injection：showPanel（监控面板，#7）、observeRoom（观察弹幕）、sendInRoom（发一条弹幕并核对回显）；addToPanel 供扩展把主播语音加进面板
```

扩展在小程序包里：`miniapp/miniapp.json` 的 `"extension": "extension"` 指向它，Dozin 的 `miniapp_install` 先把它装进 `<home>/extensions/packages/audience-bot/`（照旧要人批准才运行），再复制小程序（不含扩展目录）；卸载小程序时扩展一起卸掉（Dozin `docs/features/miniapp-extension.md`）。两者运行时不直接通信，只靠目录名 `audience-bot` 对上：扩展注册时 Dozin 用包名建 `connectors/audience-bot/`，人格页按这个名字读写。

## #2 Dozin 需要提供的能力

| 能力 | 用在哪 |
|---|---|
| 扩展宿主：从目录安装、按哈希批准、独立进程、把人允许的标签页交给扩展（`ctx.browser`） | 运行扩展 |
| Gateway：connectors 目录、带 `chat` 的 connector 把消息分批送进接入的对话、`gateway_send`、`gateway_attach` | 消息进对话、回复发出 |
| 外置小程序宿主：安装 `.asar`、`miniapp://<appId>/` 加载、注入 `MAESTROSDK` | 打开人格页 |
| `MAESTROSDK.connectors`：`agentMdPath`、`readAgentMd`、`writeAgentMd`（带 `stamp`）、`onAgentMdChange` | 人格页读写 `Agent.md` |

人格页用到的 SDK 形状：

```ts
interface AgentMdFile { path: string; exists: boolean; content: string; bytes: number; limit: number; stamp: string }
type AgentMdWrite = { ok: true; stamp: string } | { ok: false; reason: 'changed' | 'io'; stamp?: string };
MAESTROSDK.connectors.readAgentMd(dir): Promise<AgentMdFile>
MAESTROSDK.connectors.writeAgentMd(dir, content, { stamp }): Promise<AgentMdWrite>   // stamp 不是磁盘当前值就不写，返回 changed
MAESTROSDK.connectors.onAgentMdChange(cb: ({ dir, stamp }) => void): () => void
```

## #3 两层提示词与运行时文件

- **connector 系统提示词**：写在 `index.mjs` 的 `systemPrompt`，随扩展自带，用户改不了：每条回复只针对一条消息、不超过 50 字、自己的消息不回、不谈钱和隐私。
- **`Agent.md`**：用户的人格，写什么都行。人格页、AI、编辑器都可以改，下一条消息起生效。两层冲突时以系统提示词为准。

| 文件（在 `<home>/` 下） | 谁写 | 谁读 |
|---|---|---|
| `connectors/audience-bot/Agent.md` | Dozin 第一次建；之后是人格页、AI、人 | Gateway 每轮读进接入对话的系统提示；人格页 |
| `connectors/audience-bot/connector.json` | Dozin，每次注册 | Dozin |
| `extensions/data/audience-bot/target.json` | 技能（AI），接管或换房间时：`{ tabId, room, ownName, voice, voiceFile }` | 扩展，每秒一次 |
| `~/.dozin-live-caption/runtime/continuous-state.json` | 语音识别程序 | 扩展（路径来自 `voiceFile`） |

## #4 人格页

- 打开时读文件填进编辑框，记下 `stamp`；保存时带上它。
- 文件在别处被改了（AI 或编辑器）：这里没有未保存的修改就自动载入并提示；有未保存的修改就让人二选一，"用别处改的"或"用我的"。保存时发现文件已被改过，同样二选一。不会悄悄覆盖任何一方。
- 超过 16 KB 时提示"超出部分不进对话"，仍可保存。
- "也可以和 AI 聊天来改"的示例句可以一键复制，复制时附上文件路径，让 AI 改对文件。
- 有未保存的修改时，刷新前用宿主的原生确认框问一次。
- Dozin 没有 `MAESTROSDK.connectors` 时，页面说明需要更新的 Dozin，编辑框不可用。

## #5 消息怎么走

| 链路 | 经过 |
|---|---|
| 接管 | 人说「接管这个直播间」→ 技能写 `target.json` → 人在 设置 › Extensions 允许标签页 → `gateway_attach audience-bot` |
| 收弹幕 | `room.mjs` 的 `observeRoom` → 扩展 `ctx.emit` → Gateway 分批 → 对话里的 `<gateway_messages>` |
| 收语音 | `voice: "tab"`：Dozin 识别这个标签页的声音 → `transcribe` 的句子 → 扩展（`role: host`，`modality: voice`）→ 同上（#8.2）。旧方式：kit → `continuous-state.json` → 扩展 |
| 回复 | AI `gateway_send` → Gateway → 扩展 `send` → `sendInRoom` 填字、发送、5 秒内在列表里看到原文才算 `verified` |
| 监控面板 | 弹幕由 `observeRoom` 、AI 回复由 `sendInRoom`（核对成功后）在页面里直接加进面板；主播语音由扩展用 `evaluate` 调 `addToPanel` 加进去（#7） |
| 停止 | `gateway_detach audience-bot`；扩展在 设置 › Extensions 关掉；删掉 `target.json` 放开标签页 |

## #6 打包与版本

- `yarn pack:miniapp`：把 `miniapp/` 打成 `dist/io.github.flashhand.audience-bot-<version>.asar`，打印 sha256；`version_code` 写成本地构建时间 `YYMMDDHHmmss`（12 位字符串），同时写进 `miniapp.json` 和 `package.json`。
- 扩展不需要构建，目录即安装包。
- 测试：`yarn test`，每个测试文件单独跑。

## #7 监控面板

Ral 2026-11-08：「Injection 部分是要向网页注入一些信息，注册一个监控面板，这个监控面板可以体现观众、主播和 AI 发出去的消息」。

- 接管标签页时先注入 `showPanel`（injection id `audience-panel`），再注入弹幕观察。面板在直播间页面左下角，按时间列最近 20 条，四种颜色：观众（带昵称）· 主播（语音）· AI · 自己（本账号人手打的）。标题行显示条数和「收起 / 展开」。无边框。
- 内容只用 `textContent` 写入，弹幕里的标签不会变成页面元素。
- AI 发出的弹幕会被观察读回成「自己」：2 分钟内同文的只留一行，显示为 AI（读回先到或后到都一样）。
- 面板只是给人看：进对话的消息不经过它；主播语音加不进去（页面刷新中）也不影响对话。
- 扩展放开标签页（换房间、关页、停止）时 Dozin 清掉全部 injection，面板随之移除。

## #8 主播语音：按标签页采音

Ral 2026-11-08 14:58：选「恢复按标签页采音」。语音之后由扩展自己采直播间这个标签页的声音、自带识别，不再靠 `kit/` 采整个 Dozin。分两步，第一步先验证只采到这个标签页。

**原理**：Dozin 用 Electron 的 `session.setDisplayMediaRequestHandler`，回调里 `audio` 传直播间标签页的 frame（Electron 转成 Chromium 的标签页采集 ID），`enableLocalEcho: true` 让直播声音照常外放。Chromium 在声音送到扬声器之前截取这个标签页的全部声音（含其中 iframe），同进程的其他标签页不混入；不经 macOS 录屏接口。扩展只调 `ctx.browser.captureAudio(tabId)`，拿到 16 kHz 单声道 Float32 帧（Dozin `docs/features/extension-audio-transport.md`）。

### #8.1 第一步：采音自检

- 清单：`dozin.capabilities` 加 `"audio"`。不加 `platforms`：采音只在 macOS Apple 芯片上可用，别的平台采音报错，弹幕功能照常。
- `target.json` 可选 `"voice": "check"`：接管标签页后只采音、只量音量（自检用；识别见 #8.2 的 `"tab"`）。写了 `voice` 时不读 `voiceFile`。
- 每秒算一次这一秒的音量（RMS，换成 dBFS，最低 -90 dB）和收到的帧数，写进监控面板标题下的一行：`采音：本标签页 · 音量 -23 dB`；没声音时显示「静音」（低于 -60 dB）。每 10 秒在扩展日志记一行汇总，不记声音内容。
- 采音失败（平台不支持、标签页没允许、超时）在面板这一行和日志里写原因；弹幕收发不受影响。放开标签页时先停采音。
- 这一步不识别、不进对话。

**实机验收**（Ral，`yarn dev:prod`）：① 直播间有声音时音量在跳；② 暂停直播、在另一个 Dozin 标签页放声音，面板仍是静音；③ 采音期间直播声音照常能听见；④ 不弹 macOS 录屏权限；⑤ 刷新直播间后能接着采。

### #8.2 第二步：识别

Ral 2026-11-08：识别选「Dozin 内置识别服务」（sherpa-onnx + Qwen3-ASR，实测对比见 Dozin `docs/features/speech-recognition.md` #7）；「模型下载中 和使用的模型 要能有渠道透露到 UI」。扩展不带模型和识别引擎。

- `target.json` `"voice": "tab"`：接管后调用 `ctx.browser.transcribe(tabId)`。每句 `ctx.emit({ text, msgId: 'voice-<streamId>-<seq>', senderName: '主播', role: 'host', modality: 'voice', at })`，同时加进面板。
- 面板状态行：识别中写「主播语音：<模型名> · 识别中」；模型下载中写「主播语音：语音模型下载中，下好后自动开始」；未下载写「主播语音：语音模型未下载」并给出要对 AI 说的话；其他失败写原因。未下载、下载中、页面刷新、识别暂时不可用时每 3 秒重试；平台不支持、Dozin 版本不支持识别、扩展没有采音能力时不重试。同一个失败原因只记一次日志。
- 人格页「主播语音」卡：用 `MAESTROSDK.speech.status()` 和 `onStatusChange` 显示每个模型的状态（已就绪 / 下载中百分比与 MB / 解压中 / 未下载）、下一路会用哪个、正在使用的模型与路数；一个已就绪的也没有且没在下载时，给一句可复制的话让 AI 下载。Dozin 没有 `MAESTROSDK.speech` 时说明需要更新，卡片不影响人格编辑。
- 模型下载：技能 `douyin-live-reply` 的「下载语音模型」一节，只从 OSS 下载、核对 sha256，按 Dozin 的下载约定（`.download/` → 解压 → `mv`）放到 `<home>/speech-models/`，下载进度因此能在人格页看到。

### #8.3 语音模型：检查与下载

Ral 2026-11-14 02:12：「在 Extension 的初始化入口函数中，需要检查 A、Q 当前配置的是哪个模型，以及是否需要下载模型」「如果没有，需要人工去选择并进行初始化。我们可以提供两个模型供人工选择，并设置一个默认选项」。选择界面在小程序（任务 speech-model-002），扩展负责检查和下载（speech-model-001）。

**当前配置的模型**就是 Dozin 会用的模型：下表里第一个已就绪的。扩展不另存人选的模型：人选哪个就下载哪个，下好后 Dozin 自然用它。清单和就绪规则抄自 Dozin `src/shared/speech/speechModels.ts` 与 `speechStatus.ts`，两边一起改。

| 顺序 | id | 名字 | 目录（`<home>/speech-models/` 下） | 压缩包大小 | 就绪 |
|---|---|---|---|---|---|
| 1 | `qwen3-asr-0.6b` | Qwen3-ASR 0.6B | `sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25` | 878702423 B | `conv_frontend.onnx`、`encoder.int8.onnx`、`decoder.int8.onnx`、`tokenizer` 都在 |
| 2 | `sensevoice-small` | SenseVoice Small | `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17` | 163002883 B | `model.int8.onnx`、`tokens.txt` 都在 |
| — | VAD | silero_vad | `silero_vad.onnx` | 643854 B | 大小正好 643854 B；没有它哪个模型都不会被用 |

`<home>` 由扩展的数据目录（扩展进程的工作目录 `<home>/userdata/extensions/audience-bot/`）往上三级得出；路径不是这个形状时不检查、后台任务报错，不猜别的位置。

**扩展加载时（`activate`）**：读 `<home>/speech-models/`，写一行扩展日志，例如 `speech model: Dozin will use Qwen3-ASR 0.6B (qwen3-asr-0.6b) — vad ready, qwen3-asr-0.6b ready, sensevoice-small missing`；没有可用模型时写 `none ready, download needed`，正在下载时写 `none ready, download in progress`。不自动下载（约 880 MB，要人选）。直播间写了 `"voice": "tab"` 而没有可用模型时，面板状态行写「主播语音：语音模型未下载，在小程序 Audience BOT 里选择并下载」（Dozin 的 `speech_model_missing`，每 3 秒重试，下好后自动开始识别）。

**后台任务 `speech-model`**（名字「下载语音模型」，`start: "manual"`，失败不自动重试）。小程序调 `MAESTROSDK.extensions.startService('audience-bot', 'speech-model', { model })` 启动，清单因此加 `service` 能力（已装的扩展要在 设置 › Extensions 重新批准）。

| 步 | 做什么 | `ctx.status` |
|---|---|---|
| 1 | `model` 不是上表两个 id 之一：报错 `unknown_model`，什么都不做 | 失败：不认识的模型 |
| 2 | 不是 macOS Apple 芯片、找不到 `<home>`：报错，什么都不做 | 失败：原因 |
| 3 | VAD 和这个模型都已就绪：直接结束 | 已就绪：Qwen3-ASR 0.6B |
| 4 | `.download/` 里有这个模型或 VAD 的文件，它或它下面任何一个文件 15 秒内变过（看改动时间 ctime，别处在下载或解压）：报错 `download_busy`，不碰它；更早留下的（上次中断）删掉重下 | 失败：另一个下载正在进行 |
| 5 | VAD 不在：从 OSS 下到 `.download/silero_vad.onnx`，核对字节数和 sha256，改名到 `<home>/speech-models/` | 下载断句模型 |
| 6 | 下载压缩包到 `.download/<压缩包>`，边下边算 sha256；下完核对字节数和 sha256 | 下载 Qwen3-ASR 0.6B：312 / 879 MB（`progress` 为字节，约每秒一次） |
| 7 | `/usr/bin/tar -xjf` 解压到 `.download/`（不要 `test_wavs`），核对就绪文件都在；目标目录有不全的旧目录就删掉；整个目录改名过去，删压缩包 | 解压中：…… |
| 8 | 再检查一次 | 已就绪：…；另一个模型先就绪时写「Dozin 会先用已就绪的 …」 |

- 地址只用 `https://dozin-public-assets.oss-cn-hangzhou.aliyuncs.com/models/speech-models/sherpa-onnx/<文件>`，不换地址。sha256 同技能 `douyin-live-reply` 第 1.1 节。
- 任何一步失败：只删掉这次开始写的 `.download/` 文件和目录，状态写「失败：<原因>，已删除下载的文件」，任务记为失败；已就绪的模型和 VAD 不动。人停止任务时同样删掉，状态写「已停止」。不做断点续传。
- 同时只跑一个：同一个任务再启动时宿主回 `already_running`；技能的下载脚本和这个任务不要同时跑（第 4 步能挡住正在变的文件）。
- Dozin 从 `.download/` 的文件大小算下载进度，所以小程序用 `MAESTROSDK.speech` 就能显示百分比；失败原因看这个任务的 `lastStatus`。

**已知限制**：两个模型都下好时 Dozin 总用 Qwen3-ASR。想改用 SenseVoice 要 Dozin 支持「首选模型」，本期不做；现在只能删掉 Qwen3-ASR 的目录。

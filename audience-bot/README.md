# audience-bot · 抖音直播间 AI 助手（Dozin）

## Quick Start

在 Dozin 任意对话里粘贴这一句，发出去：

```text
安装 Audience BOT：读 https://raw.githubusercontent.com/FlashHand/miniapp-playground/main/audience-bot/README.md ，按其中「给 Agent 的安装步骤」一步步做完
```

AI 会装好小程序、扩展和技能。只剩一步要你自己点：在 设置 › Extensions 批准并打开扩展 `audience-bot`。然后：

1. 在 Dozin 浏览器打开直播间 `https://live.douyin.com/<房间号>`，登录要发弹幕的账号。
2. 在直播间旁的对话里说「接管这个抖音直播间」。
3. 在小程序 Audience BOT 里写 BOT 的人格，保存后下一条回复起生效；也可以直接跟 AI 说想怎么改。

需要带「外置小程序」功能的 Dozin。Dozin Preview 0.0.237 及更早的版本没有这项功能，AI 会在第 0 步停下并告诉你。

## 给 Agent 的安装步骤

按顺序做，每步看结果再往下；失败就停下，告诉用户卡在哪一步和原因。

0. **检查 Dozin**：你的工具里要有 `miniapp_install`（不在列表里就先用 `tool_search` 搜一次）。没有就停下，告诉用户：这个 Dozin 版本不支持外置小程序，请先更新 Dozin。不要用别的办法代替。
1. **取包**：把仓库放到本机。用户指定了目录就用它，否则用 `~/miniapp-playground`。目录不存在：`git clone --depth 1 https://github.com/FlashHand/miniapp-playground.git <目录>`；已存在且是这个仓库：`git -C <目录> pull --ff-only`。没有 git 时下载 `https://github.com/FlashHand/miniapp-playground/archive/refs/heads/main.zip` 解压到这个目录。下文 `<pkg>` = `<目录>/audience-bot`。
2. **小程序和扩展**：`miniapp_install`，`path` = `<pkg>/miniapp`。它会一起装上扩展 `audience-bot`（结果里的 `extension`），并返回安装手册 `install_guide`：照手册做完。
3. **技能**：`skill_install`，先 `action: "inspect"`、`input: "https://github.com/FlashHand/miniapp-playground"`，再用 `action: "install"` 只装候选路径 `audience-bot/skill/douyin-live-reply`，`scope: "shared"`。已经装过（`action: "list"` 里有它）就用 `action: "update"` 和它的 `installation_id`。
4. **批准扩展**：扩展装上后是「待批准」，不会运行。告诉用户到 设置 › Extensions 批准并打开 `audience-bot`（可以用 `menu {"tab":"extensions"}` 打开那一页）。不要替用户批准，也不要在 `gateway_sources` 出现 `audience-bot` 之前说它已经在运行。
5. **报告**：小程序、扩展、技能各装上没有，版本号（`<pkg>/miniapp/miniapp.json` 的 `version`），还要用户做的那一步。再告诉用户怎么开始：在 Dozin 浏览器打开直播间并登录，在旁边的对话里说「接管这个抖音直播间」。

主播语音还在开发：扩展能按标签页采音做自检（技能里「试一下采音」），还不识别。要现在就有语音转文字，在 macOS 上运行 `<pkg>/kit/install.sh`（要 Xcode Command Line Tools 和 cmake，会下载约 547 MB 模型）：这一步先问用户，不要自己跑。

**更新**：第 1 步拉最新，再做第 2、3 步。扩展的文件变了，Dozin 会要求重新批准，照第 4 步提醒用户。

**卸载**：`miniapp_uninstall`，`app_id` = `io.github.flashhand.audience-bot`（扩展一起卸掉）；技能用 `skill_install` 的 `action: "list"` 找到 `installation_id`，再 `action: "remove"`。

## 是什么

An AI assistant for Douyin (抖音) live rooms, built for [Dozin](https://dozin.ai): live comments and the host's voice flow into a Dozin chat, and the chat's AI replies as comments, following a persona you write.

Audience BOT 让 Dozin 里的一个 AI 对话接管抖音直播间：弹幕和主播语音进入对话，AI 按你写的人格回弹幕。对话里不起后台进程，消息由 Dozin 的 Gateway 推进对话。

## 组成

| 目录 | 是什么 |
|---|---|
| [`miniapp/`](miniapp/) | Dozin 外置小程序"Audience BOT"：编辑 BOT 的人格（`Agent.md`），提示也可以和 AI 聊天来改。安装它时一起装下面的扩展 |
| [`miniapp/extension/`](miniapp/extension/) | 小程序带的 Dozin 扩展：在直播间标签页里收弹幕、读主播语音、发回复，注册一个 Gateway connector |
| [`skill/douyin-live-reply/`](skill/douyin-live-reply/) | 技能：教 Dozin 的 AI 一句话接管直播间 |
| [`kit/`](kit/) | 本机语音识别（macOS）：把主播的话转成文字给扩展读 |
| [`docs/design.md`](docs/design.md) | 设计：组成、消息流、两层提示词、人格页行为 |

## 现状（v0.2.0）

| 部分 | 状态 |
|---|---|
| 扩展 `audience-bot` | 弹幕收发、直播间监控面板、按标签页采音自检。需要支持 connector `chat` 与「小程序带扩展」的 Dozin 版本；真直播间里的发送、面板与采音还没有实测 |
| 小程序（人格页） | 代码与测试完成；需要 Dozin 支持外置小程序和 `MAESTROSDK.connectors`，在这之前页面会提示版本不支持。「主播语音」卡显示语音模型下载进度和正在使用的模型（需要 `MAESTROSDK.speech`） |
| 主播语音转文字 | 开发中（design.md #8.2）：`target.json` 写 `"voice": "tab"` 时由 Dozin 在本机识别直播间标签页的声音（默认 Qwen3-ASR），只听这个标签页、不要录屏权限；第一次用要下载约 880 MB 模型（在对话里说「下载 Audience BOT 的语音模型」）。需要带内置语音识别的 Dozin（macOS 14+、Apple 芯片），真直播间未实测。旧方式 `kit/` 仍可用，采的是 Dozin 整个应用的声音 |

从 v0.1.0 升级：扩展从 `douyin-live` 改名为 `audience-bot`，人格文件也换到 `connectors/audience-bot/Agent.md`。旧扩展 `douyin-live` 不会自动删，在 设置 › Extensions 卸掉它；旧人格要沿用，把 `connectors/douyin-live/Agent.md` 的内容复制过去。

## 手动安装

1. `git clone https://github.com/FlashHand/miniapp-playground.git`，本包在其中的 `audience-bot/`。
2. **小程序和扩展**：在 Dozin 对话里说「安装小程序 <clone 的目录>/audience-bot/miniapp」。小程序和它带的扩展一起装上（Dozin 的 `miniapp_install`）；然后在 设置 › Extensions 批准并打开扩展 `audience-bot`。
3. **技能和语音识别**（要主播语音时）：在 macOS 上运行 `kit/install.sh`（需要 Xcode Command Line Tools 和 cmake），它会编译识别器、下载并校验模型、签名采音 App，并把技能装进 Dozin 的技能目录。只要弹幕不要语音时，可以只把 `skill/douyin-live-reply/` 复制到 `~/.dozin/skills/`。
4. **打包**（可选）：`yarn install && yarn pack:miniapp` 生成 `dist/io.github.flashhand.audience-bot-<version>.asar`，里面同样含扩展。

## 使用

1. 在 Dozin 的浏览器里打开直播间 `https://live.douyin.com/<房间号>`，登录要发弹幕的账号。
2. 要语音时运行 `kit/start-bridge.sh` 和 `kit/start-caption.sh`（`kit/doctor.sh` 检查状态，`kit/stop.sh` 停止）。
3. 在直播间旁的 Dozin 对话里说「接管这个抖音直播间」，按 AI 的提示在 设置 › Extensions 允许这个标签页。
4. 在小程序"Audience BOT"里写人格，或直接在对话里让 AI 改。改了下一条回复起生效。

请遵守抖音的平台规则，AI 发出的内容由使用者负责。

## 开发

```bash
yarn install
yarn test           # 每个测试文件单独跑
yarn pack:miniapp   # 打小程序 .asar，打印 sha256
```

## License

[MIT](LICENSE)

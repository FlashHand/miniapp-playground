# miniapp-playground

A collection of packages for [Dozin](https://dozin.ai). Each directory is one package that may hold a mini app, the extension it ships, a skill and docs.

Dozin 的多应用仓库：每个目录是一个包，可以包含小程序、它带的扩展、技能和文档。

| 包 Package | 是什么 |
|---|---|
| [`audience-bot/`](audience-bot/) | Audience BOT：抖音直播间 AI 助手。弹幕和主播语音进入 Dozin 的一个对话，对话里的 AI 按你写的人格回弹幕。小程序（人格页）+ 扩展（收发弹幕、监控面板、采音）+ 技能（接管直播间） |

## 安装 Audience BOT

在 Dozin 的任意对话里说：

> 按 https://github.com/FlashHand/miniapp-playground 的 README 安装 Audience BOT

AI 照下面的步骤装好，最后只剩一步要你点：在 设置 › Extensions 批准并打开扩展 `audience-bot`。

### 给 Agent 的步骤

按顺序做，每步看结果再往下；失败就停下，告诉用户卡在哪一步和原因。

1. **取包**：把本仓库放到本机。用户指定了目录就用它，否则用 `~/miniapp-playground`。目录不存在：`git clone --depth 1 https://github.com/FlashHand/miniapp-playground.git <目录>`；已存在且是本仓库：`git -C <目录> pull --ff-only`。没有 git 时下载 `https://github.com/FlashHand/miniapp-playground/archive/refs/heads/main.zip` 解压到这个目录。下文 `<pkg>` = `<目录>/audience-bot`。
2. **小程序和扩展**：`miniapp_install`，`path` = `<pkg>/miniapp`。它一起装上扩展 `audience-bot`（结果里的 `extension`），并返回安装手册 `install_guide`：照手册做完。
3. **技能**：`skill_install`，先 `action: "inspect"`、`input: "https://github.com/FlashHand/miniapp-playground"`，再用 `action: "install"` 只装候选路径 `audience-bot/skill/douyin-live-reply`，`scope: "shared"`。已经装过（`action: "list"` 里有它）就用 `action: "update"` 和它的 `installation_id`。
4. **批准扩展**：扩展装上后是「待批准」，不会运行。告诉用户到 设置 › Extensions 批准并打开 `audience-bot`（可以用 `menu {"tab":"extensions"}` 打开那一页）。不要替用户批准，也不要在 `gateway_sources` 出现 `audience-bot` 之前说它已经在运行。
5. **报告**：小程序、扩展、技能各装上没有、版本号（`<pkg>/miniapp/miniapp.json` 的 `version`）、还要用户做的那一步。然后告诉用户怎么开始：在 Dozin 浏览器打开直播间并登录，在旁边的对话里说「接管这个抖音直播间」。

主播语音还在开发：扩展能按标签页采音做自检（技能里「试一下采音」），还不识别。要现在就有语音转文字，在 macOS 上运行 `<pkg>/kit/install.sh`（要 Xcode Command Line Tools 和 cmake，会下载约 547 MB 模型）：这一步先问用户，不要自己跑。

**更新**：第 1 步拉最新，再做第 2、3 步。扩展的文件变了，Dozin 会要求重新批准，照第 4 步提醒用户。

**卸载**：`miniapp_uninstall`，`app_id` = `io.github.flashhand.audience-bot`（扩展一起卸掉）；技能用 `skill_install` 的 `action: "list"` 找到 `installation_id`，再 `action: "remove"`。

## 开发

每个包自带测试，例如 `cd audience-bot && yarn install && yarn test`。包的设计见各自的 `docs/`。

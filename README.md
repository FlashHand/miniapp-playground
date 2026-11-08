# miniapp-playground

A collection of packages for [Dozin](https://dozin.ai). Each directory is one package that may hold a mini app, the extension it ships, a skill and docs.

## Quick Start · Audience BOT

在 Dozin 任意对话里粘贴这一句，发出去：

```text
安装 Audience BOT：读 https://raw.githubusercontent.com/FlashHand/miniapp-playground/main/audience-bot/README.md ，按其中「给 Agent 的安装步骤」一步步做完
```

AI 装好小程序、扩展和技能后，只剩一步要你自己点：在 设置 › Extensions 批准并打开扩展 `audience-bot`。怎么开始用、对 Dozin 版本的要求，见 [audience-bot/README.md](audience-bot/README.md)。

给 Agent：安装步骤只在 [audience-bot/README.md](audience-bot/README.md) 的「给 Agent 的安装步骤」，照那里做。

## 包

Dozin 的多应用仓库：每个目录是一个包，可以包含小程序、它带的扩展、技能和文档。

| 包 Package | 是什么 |
|---|---|
| [`audience-bot/`](audience-bot/) | Audience BOT：抖音直播间 AI 助手。弹幕和主播语音进入 Dozin 的一个对话，对话里的 AI 按你写的人格回弹幕。小程序（人格页）+ 扩展（收发弹幕、监控面板、采音）+ 技能（接管直播间） |

## 开发

每个包自带测试，例如 `cd audience-bot && yarn install && yarn test`。包的设计见各自的 `docs/`。

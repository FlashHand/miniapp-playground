---
id: extension-003
scope: 主播语音第二步：Dozin 内置识别（transcribe）进对话与面板；人格页「主播语音」卡显示模型状态与下载进度；技能的模型下载步骤；自检改为 voice=check
status: in_progress
depends-on: [extension-002, Dozin speech-003, Dozin speech-004]
verify: "yarn test（每个文件单独跑）；真直播间由 Ral 验收"
---

# extension-003

契约：[design.md](../../design.md) #8.2。Dozin 侧：`docs/features/speech-recognition.md`（任务 speech-001…004）。

- 2026-11-08 19:35：实现。`voice: "tab"` 改由 Dozin 识别（`startTabSpeech`），`voice: "check"` 保留采音自检；面板状态行显示正在用的模型 / 下载中 / 未下载；同一失败原因只记一次日志；两个启动函数都推迟到微任务再可能调用 onEnd。人格页「主播语音」卡（`miniapp/speech.js`）。技能加「1.1 下载语音模型」，脚本用 SenseVoice 实跑一次：3 秒下完、sha256 一致、`.download/` 清空。`yarn test`：douyinLive 15/15、miniapp 11/11。真直播间未测。

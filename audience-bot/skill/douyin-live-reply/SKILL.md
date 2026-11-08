---
name: douyin-live-reply
description: >-
  通过 Gateway 接管抖音直播间对话：audience-bot 扩展在直播间标签页里收弹幕、读主播语音转写，交给 Gateway；
  Gateway 把它们以事件推进接入的对话，对话 AI 用 gateway_send 回弹幕。对话里不起任何后台进程。
  用于“对这个直播间开启AI回复功能”“接管这个抖音直播间”“开启直播间监控”及明确的换房间请求。
---

# 抖音直播间接管（扩展 + Gateway）

收发由 Audience BOT 包（github.com/FlashHand/miniapp-playground 的 `audience-bot/`）里 `miniapp/extension/` 的扩展完成，Gateway 负责把消息送进对话（设计见仓库的 `docs/design.md`）。本对话**不轮询、不起后台进程**：弹幕和主播语音以 `<gateway_messages>` 事件到达。

下文 `<home>` 是应用主目录（Dozin Preview 为 `~/.dozin_preview`，正式版 `~/.dozin`）；`<repo>` 是用户 clone 的 miniapp-playground 里的 `audience-bot/` 目录，不知道就问用户。

## 0. 前提

- `gateway_sources`：Gateway 必须是 `open`。不是就请用户在 设置 › Gateway 打开，停在这里。
- 看结果里有没有 `audience-bot`（种类 `extension`）：
  - 有：扩展已在运行，跳到第 1 步。
  - 没有：确认 `<home>/extensions/packages/audience-bot/` 是否存在。不存在就 `miniapp_install` `<repo>/miniapp`（小程序和扩展一起装）。然后用 `menu {"tab":"extensions"}` 打开 设置 › Extensions，请用户批准并打开 `audience-bot`。用户说好了，再调 `gateway_sources` 确认出现 `audience-bot`；没出现就停下，说明卡在哪一步。
- 定位用户指定的 `https://live.douyin.com/<room>` 标签页，用 `page_snapshot` 确认是直播间、已登录、输入框在。只用这个标签页。
- 取得本账号显示名（用户给过就沿用），作为 `ownName`：自己的消息只作上下文，绝不回复。

## 1. 写目标

写 `<home>/extensions/data/audience-bot/target.json`：

```json
{ "tabId": "tab-28", "room": "123456789012", "ownName": "<本账号的显示名>", "voice": "tab" }
```

- `"voice": "tab"`：主播语音由 Dozin 在本机识别，只听这个标签页，不用 kit、不要录屏权限。要先有语音模型：没有时直播间左下角面板写「主播语音：语音模型未下载」，按第 1.1 步下载；下好后扩展自动开始识别，面板写「主播语音：<模型名> · 识别中」。不要语音就不写 `voice`。
- 采音自检：用户要试采音时把 `voice` 写成 `"check"`。扩展只采这个标签页的声音、每秒在面板写一行「采音：本标签页 · 音量 … dB / 静音」，不识别、不进对话。请用户按设计 #8.1 的五项看：有声时音量跳动、另一个标签页出声时这里仍静音、直播声音照常外放、不弹录屏权限、刷新后接着采。面板写「采音失败：…」或「主播语音：…」的原因时告诉用户。
- 旧方式 `voiceFile`（Dozin 没有语音识别时）：先按 [references/local-runtime.md](references/local-runtime.md) 确认采音程序和识别桥在跑、快照在更新（由仓库 `kit/` 的脚本启动，不在本对话里起），写 `"voiceFile": "<快照的绝对路径>"`。采音范围是整个应用音轨，先请用户确认 Dozin 里只有这个直播在出声。写了 `voice` 时不读 `voiceFile`。
- 扩展每秒读这个文件，内容变了就换目标。

## 1.1 下载语音模型

用户说「下载 Audience BOT 的语音模型」时照做。接管时发现没有模型（面板或人格页写「未下载」），先告诉用户要下载约 880 MB，用户同意再下。只从下面的 OSS 地址下载；只支持 macOS Apple 芯片。

模型放在 `<home>/speech-models/`。先放 `.download/`、核对 sha256、解压到 `.download/`，再把整个目录 `mv` 过去。Dozin 看这个目录给出下载进度，用户在小程序 Audience BOT 的「主播语音」卡里能看到百分比。用后台任务跑（`run_in_background`），不要在对话里轮询；把 `<home>` 换成实际路径。

```bash
H="<home>/speech-models"; D="$H/.download"
B=https://dozin-public-assets.oss-cn-hangzhou.aliyuncs.com/models/speech-models/sherpa-onnx
A=sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25   # 878702423 B
mkdir -p "$D" || exit 1
if [ "$(stat -f%z "$H/silero_vad.onnx" 2>/dev/null)" != 643854 ]; then
  curl -fL --retry 3 -C - -o "$D/silero_vad.onnx" "$B/silero_vad.onnx" || exit 1
  [ "$(shasum -a 256 "$D/silero_vad.onnx" | cut -d' ' -f1)" = 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6 ] || { rm -f "$D/silero_vad.onnx"; echo "silero_vad checksum mismatch"; exit 1; }
  mv "$D/silero_vad.onnx" "$H/silero_vad.onnx"
fi
if [ ! -d "$H/$A" ]; then
  curl -fL --retry 3 -C - -o "$D/$A.tar.bz2" "$B/$A.tar.bz2" || exit 1
  [ "$(shasum -a 256 "$D/$A.tar.bz2" | cut -d' ' -f1)" = 393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96 ] || { rm -f "$D/$A.tar.bz2"; echo "model checksum mismatch"; exit 1; }
  rm -rf "$D/$A" && tar -xjf "$D/$A.tar.bz2" -C "$D" --exclude '*/test_wavs' && mv "$D/$A" "$H/$A" && rm -f "$D/$A.tar.bz2" || exit 1
fi
echo "speech model ready: $A"
```

- 校验失败就停下告诉用户，不要改用别的下载地址。中断后重跑同一段会接着下。
- 内存小或只想要小模型时，可改下 SenseVoice：`A=sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`（163002883 B，sha256 `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e`）。两个都在时 Dozin 用 Qwen3-ASR。
- 下完告诉用户：直播间里写了 `"voice": "tab"` 的话几秒内自动开始识别。

## 2. 允许标签页

用 `menu {"tab":"extensions"}` 打开 设置 › Extensions，请用户在 `audience-bot` 的标签页授权里填 `tabId` 并点授权。扩展不能自己拿标签页。之后 `gateway_sources` 里 `audience-bot` 的状态是 `live` 才算接上。

## 3. 接入对话与人设

- `gateway_attach {"source":"audience-bot","target":"this"}`；用户要求时 `target` 用 `"new"`、`"new_child"` 或某个子对话 id。
- 用户给的人设与风格写进 `gateway_sources` 里 `audience-bot` 的 `agent_md`（`<home>/connectors/audience-bot/Agent.md`）：例如主播优先；温和幽默，不攻击身体或能力；不虚构个人经历；索要礼物时按用户给的固定话术；60 秒没人说话可以起一个相关的短话题。已有内容先读，只改用户要改的部分。改了下一条消息起生效。
- 扩展自带的系统提示词（每条回复针对一条消息、不超过 50 字、自己的消息不回、不谈钱和隐私）改不了，冲突时以它为准。

## 4. 回复

- 收到 `<gateway_messages>` 后按规则决定回不回。要回就 `gateway_send {"source":"audience-bot","text":"…","reply_to":"#n"}`，一次调用即完成发送。不要自己找输入框、点按钮或看页面。
- 文字不加 @：回观众时扩展按 `reply_to` 加 `@昵称`（放得下才加）。总长 ≤ 50。
- 回执 `verified: true` 才算发出。`verified: false`、`receipt_timeout` 或 `not_sent` 时先看下一批消息里有没有回显，绝不直接重发同一句。`input_busy` 表示输入框里有用户自己的草稿，不要动它。
- 主播明确拒绝 AI 互动时停止发言，并告诉用户。

## 5. 换房间与停止

- 换房间：改写 `target.json` 的 `tabId` / `room`，再请用户授权新标签页（第 2 步）。对话不用重新接入。
- 停止回复：`gateway_detach {"source":"audience-bot"}`。要扩展也停下，请用户在 设置 › Extensions 关掉 `audience-bot`；删掉 `target.json` 可让它放开标签页。

## 没有扩展时（旧方式，只收弹幕）

扩展装不上（例如在 Cowork 里）时，读 `scripts/douyin-source.js`，把 `__OWN_NAME__` 换成 JSON 字符串，调用 `gateway_register`（`tab_id` 为直播间，`source` 为 `{"schema":"dozin.gateway.source/v1","type":"audience-bot","instance":"<room>","title":"抖音 · <主播名>","systemPrompt":"…","send":{"enabled":true,"maxLength":50,"maxPerMinute":4},"roles":{"host":"主播","viewer":"观众","self":"自己"}}`），再 `gateway_attach audience-bot#<room>`。这种方式没有主播语音，也不起后台转发。

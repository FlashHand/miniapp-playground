---
id: speech-model-002
scope: 小程序「主播语音」卡：有没有可用的语音模型；没有时在两个模型里选一个（默认 Qwen3-ASR 0.6B），点「下载并初始化」交给扩展的后台任务
status: implemented; owner verification pending
depends-on: [speech-model-001]
verify: "yarn test（每个文件单独跑）；Chrome 打开页面截图自查布局；真机下载由 Ral 验收"
---

# speech-model-002

契约：[design.md](../../design.md) #8.2、#8.3（#8.3 由 speech-model-001 写）。交接：overmind `tmp/dozin-package/brief-speech-model.md`。

Ral 2026-11-14 02:12：「UI 上可以检查当前是否有模型。如果没有，需要人工去选择并进行初始化。我们可以提供两个模型供人工选择，并设置一个默认选项。」「这部分 UI 的功能是放在 Mini APP 的 audience 中的 Mini APP 部分去实现的。」

## 做法

只改 `miniapp/speech.js`、`miniapp/index.html`、`miniapp/app.css`、`test/miniapp.test.mjs`。

- 有可用模型（`MAESTROSDK.speech` 状态的 `selected` 不为 null）：照现在显示，不出现选择区。
- 没有可用模型（且这台电脑支持识别）：出现选择区。
  - 两个单选：Qwen3-ASR 0.6B（默认选中；约 880 MB，中文更准，带标点，识别时多用约 1.5 GB 内存）、SenseVoice Small（约 163 MB，更小、更省内存，中文略差）。某个模型已经下好、只差断句模型时，默认选它。
  - 按钮「下载并初始化」：`MAESTROSDK.extensions.startService('audience-bot', 'speech-model', { model })`。
- 下载中、解压中（`speech` 状态有 downloading / installing，或后台任务在 starting / running / stopping / backoff，或刚点了按钮还没有结果）：模型行照旧显示进度；按钮变「下载中…」不可点，单选不可改；状态行显示后台任务的 `lastStatus`。
- 失败：后台任务 `lastStatus` 是 error / warn，或 `startService` 被拒：状态行显示原因，按钮恢复可点。
- 按钮不可用并写明原因，同时显示原来那句可复制的话「下载 Audience BOT 的语音模型」作为后备：
  - 宿主没有 `MAESTROSDK.extensions.startService`；
  - `extensions.get('audience-bot')` 读不到、扩展没装、没批准或没打开、没在运行；
  - 扩展没有 `speech-model` 任务（旧版扩展）。
- 后台任务的状态没有推送：选择区出现时每 2 秒读一次 `extensions.get`，`speech` 状态变化时也读一次；选择区收起后停止。
- 「只支持 macOS Apple 芯片」与「Dozin 版本不支持 MAESTROSDK.speech」的提示照旧。

## 验证

linkedom 单测：没模型时出现选择区且默认选中 Qwen3；点按钮以选中的 id 调 `startService`；下载中按钮不可点并显示进度；失败显示原因、按钮恢复；有模型时选择区不出现；没有 `startService`、扩展没批准、扩展没有任务时按钮不可用、后备句子还在。`yarn test` 全过。Chrome 打开页面截图自查布局（截图放 overmind `tmp/`，用完删）。不跑 Electron E2E。

## 记录

- 2026-11-14 02:20：开始（主对话转 Ral 02:12）。
- 2026-11-14 02:35：实现。`miniapp/speech.js` 加 `pickerView`（纯函数）与接线，`index.html` 加选择区，`app.css` 加样式（无边框，`:has` 标出选中项）。`test/miniapp.test.mjs` 新增 7 项，全文件 18/18；负对照（默认改成 SenseVoice、去掉忙碌判断）5 项失败，说明测试拦得住。`yarn test`：douyinLive 15/15、miniapp 18/18；`speechModel.test.mjs` 是 speech-model-001 正在写的文件，当时 9/10。Chrome 截了三种状态（待选、下载中、扩展没批准），布局正常，截图已删。确认 #2 改过的 `MAESTROSDK.connectors` 只认小程序自己的目录（`entry.package || entry.extensionName`）：扩展名就是 `audience-bot`，与人格页的 `CONNECTOR_DIR` 一致，不受影响。没改 Dozin、Cowork；未提交。真机下载由 Ral 验收。

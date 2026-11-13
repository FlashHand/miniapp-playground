---
id: speech-model-001
scope: 扩展检查语音模型（activate 时写一行日志；面板提示改为去小程序选择下载）；后台任务 speech-model 按 Dozin 的下载约定下载、校验、解压、落位一个模型
status: in_progress
depends-on: [extension-003, Dozin extension-service-013, Dozin speech-004]
verify: "yarn test（每个文件单独跑，带 --test-isolation=none --test-timeout --test-force-exit）；真机下载由 Ral 验收"
---

# speech-model-001

契约：[design.md](../../design.md) #8.3。小程序一侧是 [speech-model-002](speech-model-002.md)（#3 负责）。Dozin 侧：`docs/features/speech-recognition.md` #4、`docs/features/extension-services.md`、`docs/features/miniapp-extension-status.md` #5。

## 需求卡

| 项 | 内容 |
|---|---|
| 目标 | Ral 2026-11-14 02:12：「在 Extension 的初始化入口函数中，需要检查 A、Q 当前配置的是哪个模型，以及是否需要下载模型」；小程序里选模型后由扩展下载并初始化 |
| 判据 | 单测通过：activate 的检查覆盖没有模型、只有 SenseVoice、两个都有、只在下载四种目录；后台任务用假下载覆盖未知模型被拒、校验不对时删临时文件且不动已就绪的模型、成功时按约定落位、已就绪时直接结束 |
| 证据 | `yarn test` 输出；真机下载（约 880 MB）由 Ral 在 Dozin 里验 |
| 线索 | Dozin `src/shared/speech/speechModels.ts`（模型清单与顺序）、`speechStatus.ts`（就绪规则）；`ctx.status(text, level, { done, total })`；`ctx.input` 来自 `MAESTROSDK.extensions.startService` |
| 约束 | 不自动下载；只从 OSS 下载；不改 Dozin、Cowork；不 commit |

## 要做的

1. `miniapp/extension/speechModel.mjs`：模型清单（抄 Dozin，顺序即优先级）、`<home>` 推法、`checkSpeechModels`、`speechCheckLine`、`runSpeechModel`。
2. `index.mjs`：注册 connector 之后注册后台任务 `speech-model`（宿主没有 `registerService` 时跳过）；activate 里检查一次并写一行日志。
3. `voice.mjs`：`speech_model_missing` 的面板文字改为「语音模型未下载，在小程序 Audience BOT 里选择并下载」。
4. `package.json`：`capabilities` 加 `service`（扩展要重新批准）。
5. 单测：`test/speechModel.test.mjs`；`test/douyinLive.test.mjs` 跟着改清单与文字。

## 记录
- 2026-11-14 02:50：实现。新文件 `miniapp/extension/speechModel.mjs`；`index.mjs` 注册 `speech-model`（`restart: never`，宿主没有 `registerService` 时跳过）并在 activate 里写一行检查日志；`voice.mjs` 改未下载提示；清单加 `service`。核对：扩展进程工作目录 = Dozin `extensionLibrary().dataDir(name)` = `<home>/userdata/extensions/<name>`，模型目录 = `appDataDir('speechModels')` = `<home>/speech-models`（Dozin `extension.runtime.ts`、`appData.ts`）；`dozin` 对象上没有 `dataDir`，后台任务的 `ctx.dataDir` 有。`yarn test`：douyinLive 15/15、miniapp 11/11、speechModel 10/10。反向核对：去掉失败清理 → 2 条失败；把模型优先顺序反过来 → 2 条失败。真机下载未测。
- 2026-11-14 03:05：独立复核（新开的子 agent，本运行环境不能指定别的模型家族）：通过，有发现，无 P0/P1。已改：P2 忙检查只看顶层修改时间，漏掉技能正在解压的大文件 → 改为看路径下每个文件的改动时间（ctime），加回归测试（换回旧检查时该测试失败）；P3 失败时只删这次开始写的文件；只有 fetch 自己的 TypeError 算网络中断；tar 报磁盘满记 `disk_full`；HTTP 失败时关掉响应体；补测大小不对、解压缺文件、不全的旧目录被替换、下载期间别处先就绪、activate 四种目录。复核说「`service` 早于 `audio`」与 git 不符：`audio` 2026-11-02、`service` 2026-11-09（`KNOWN_CAPABILITIES` 历史），以 git 为准。`yarn test`：douyinLive 15/15、miniapp 18/18、speechModel 13/13。真机下载、重新批准未做，等 Ral。

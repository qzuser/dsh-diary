# dsh-diary

每天晚上到点，让 DSH 里的 agent **给自己写两篇日记**：一篇公开、一篇私密。

插件本身**不生成文字**——它只做三件事：当闹钟、扫数据、把资料塞进一个回合。真正写字的是 agent 本身，所以它带着自己的上下文和判断，而不是插件拿着 API key 硬凑一篇。

## 它是怎么跑的

```
每 60 秒 tick 一次
   ├─ 今天该写吗？（weekdays / enabled）
   ├─ 到这个点了吗？（times，支持多个；错过了 catchUpHours 内还补）
   ├─ 没写过？ → 采集今天的数据 → 压成 markdown
   ├─ 写两个骨架文件（中途失败也不会一片空白）
   └─ sessionController.prompt() 往专用会话塞一个回合
        └─ agent 醒来，按指令写两篇，回一行确认
```

采集的数据（全部只读）：

| 来源 | 内容 |
| --- | --- |
| `~/.dsh/storages/session_projcache/sessions/*.json` | 今天的会话：标题、工作目录、每轮「问/答」摘要、轮次、步数、耗时、token |
| 同上 `todos` | 还压着没做完的事 |
| `~/.dsh/whale-log.jsonl` | 鲸鱼（B站）今天干了什么 |
| `~/.dsh/feiyu-mood/`、`fish-memory/`、`whale-night.json` 等 | 其他插件的痕迹（通用摘录，不解析结构，插件升级也不会崩） |
| `~/.dsh/logs/*.log` | 运行日志尾巴（默认关，体积大） |

## 落点

默认 `~/.dsh/diary/2026-10-31.public.md` 和 `.private.md`。

文件名模板支持 `{date} {yyyy} {mm} {dd} {weekday} {iso}`；`outDir` 可以指到任何地方；`monthlyDir` 打开会放成 `2026-10/`。

## 装 / 卸

```powershell
# 装（本仓库就是源码目录）
dsh plugin --profile desktop add "link:C:\Users\<你>\.dsh\plugins\dsh-diary"

# 卸
dsh plugin --profile desktop remove dsh-diary
```

手动装也行：在 profile 的 `package.json` 里写 `dependencies["dsh-diary"] = "link:C:/.../dsh-diary"`，`dsh.profile.bundles` 里加 `"dsh-diary"`，然后 `pnpm install`。

**插件是启动时加载的，改完要重启 DSH 才生效。**

## 配置

全部配置在 `~/.dsh/diary-config.json`，也能在 **设置 → 日记** 里改。改完下一跳生效，不用重启。

| 键 | 说明 |
| --- | --- |
| `enabled` | 总开关 |
| `times` | 时间点数组，24 小时制 `HH:MM`，可以写多个：`["12:30","22:00"]` |
| `weekdays` | 哪几天写，0=周日…6=周六 |
| `catchUpHours` | 错过之后多少小时内还补写；`0` 只在那一分钟写 |
| `sessionId` | 目标会话；留空 = 专用会话 `dsh-diary`（推荐，别污染你正在聊的会话） |
| `cwd` | 那个会话的工作目录；留空 = `~/.dsh/diary-work` |
| `model` | 模型覆盖（留空用会话默认） |
| `outDir` | 输出目录，支持 `~` |
| `publicPattern` / `privatePattern` | 两篇的文件名模板 |
| `monthlyDir` | 按月分子目录 |
| `publicWords` / `privateWords` | 目标字数（写进指令的软约束） |
| `style` | 文风指令，直接拼进 prompt |
| `persona` | 人设补充：让写日记的"自己"知道它是谁 |
| `redact` | 公开篇禁词，命中要求换说法 |
| `publicHidePaths` | 公开篇不出现盘符/用户名/端口 |
| `sources.*` | 八类数据源，每个都能单独关 |
| `maxSessions` / `maxTurnsPerSession` | 采样上限 |
| `maxPromptChars` / `maxResponseChars` | 每轮问答各截多少字 |
| `maxDataChars` | 数据摘要总字数上限（防 prompt 撑爆上下文） |
| `promptTemplate` | **完全接管指令**。可用占位符见设置页 |
| `keepDays` / `autoCleanup` | 保留天数与自动清理 |

### 占位符

`promptTemplate` 里能用的：

```
{date} {time} {data}
{publicPath} {privatePath}
{publicWords} {privateWords}
{style} {persona} {redactLine} {hidePathsLine}
```

`data` 就是整段采集结果。想把日记改成周报，直接重写模板就行——这是"高自定义"的出口。

## 手动跑

设置页有三个按钮：

- **立即生成一次** —— 立刻投递（不算定时，不影响当天的时间点记录）
- **预览今天的数据** —— 只采集、显示会喂给 agent 的完整指令，不投递
- **看已有日记** / **打开目录**

也可以打接口：

```powershell
curl.exe -s http://127.0.0.1:3080/dsh-diary/api/status
curl.exe -s -X POST http://127.0.0.1:3080/dsh-diary/api/run
curl.exe -s http://127.0.0.1:3080/dsh-diary/api/preview
```

## 常见问题

**到点了没写**
先看 `GET /api/status` 的 `lastTick.reason`：显示"等时间"说明时钟活着，只是没到点；显示"已关闭"看 `enabled`。再看 `today/ranToday`，已经跑过就不会重复跑。

**写了但文件是骨架**
说明投递成功了但 agent 那一步没写完。骨架文件会写明"这一篇还在写"。去 `dsh-diary` 会话里看它卡在哪。

**prompt 太长 / 太费 token**
调小 `maxSessions`、`maxTurnsPerSession`、`maxDataChars`。或者关掉 `sources.logs` 和 `sources.plugins`。

**时间改了没生效**
配置是每跳重读的，60 秒内就生效。但如果改的是 `sessionId`，那要等下一个时间点。

## 和 whale-diary 的区别

`~/.dsh/whale-diary*.md` 是 `dsh-bili-whale` 里**那条鱼**的日记，写的是刷 B 站的事。
`dsh-diary` 写的是**这台机器上的 agent 自己**——你今天跟它干了什么、它怎么想的。两套互不干扰，可以同时开。

## 界面预览

不想先装再看，可以直接打开这两份静态页面（自包含，双击即开会用浏览器渲染）：

- [浅色](docs/preview-light.html)
- [深色](docs/preview-dark.html)

它们是把 `lib/client.js` 里的样式原样抽出来、配一份等价 DOM 手工拼的，用来核对排版。不是截图，但和设置页长得一样。

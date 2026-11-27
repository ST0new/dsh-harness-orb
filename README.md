# DSH 完成与等待提醒 · dsh-harness-orb

![图标](icon.svg)

给 DeepSeek Harness 加一道**真的会喊你**的提醒：回合跑完、或者 DSH 正在等你批准 / 回答时，只要窗口不在前台，就响铃并弹出系统通知。

侧栏那个绿点 / 橙点只有在你回头看屏幕时才有用。这个插件负责把你从别的应用里叫回来。

---

## 功能

- **两种触发时机**
  - 回合跑完（包括你正开着的那条会话）；
  - DSH 正在等你——工具审批、智能体提问，以及其它需要你确认的交互。
- **只在窗口不在前台时提醒**，不打扰你正在盯着屏幕的时刻。
- **通知带会话名**，点击通知会切回窗口并直接打开那条会话。
- **重复提醒**：没人处理的审批 / 提问会在约 2 分钟、6 分钟后再各提醒一次，此后停止。
- **关闭再打开不会失效**：重开应用时，仍在等待的请求会被接管，继续按上面的节奏催。
- **三档独立提示音**：完成 / 待审批 / 待回答各一套，可用内置铃音，也可换成自己的音频文件。
- **重复提醒可加大音量**：第 2、3 次分别约 1.5 倍、2 倍，可开关。

## 安装

需要 **DeepSeek Harness Desktop**（或带 Web GUI 的 DSH）。本插件是 DSH 的 bundle，包含一个 Host 行和一个浏览器模块，**没有构建步骤**。

1. 克隆或下载本仓库到任意本地目录：

   ```bash
   git clone https://github.com/<你的账号>/dsh-harness-orb.git
   ```

2. 打开 DSH → **设置 → 插件** → **「添加插件」**（Add plugin）→ 选择上一步的目录。
3. 启用后，进入 **设置 → 通用**，会看到本插件的两行偏好设置。

> 「添加插件」做的是把本地目录链接进当前 profile，所以之后 `git pull` 的改动可以直接生效——在插件页把本插件**关闭再启用**即可重新加载浏览器模块，不必重启应用。

## 设置

设置 → 通用里新增两行，位置紧接在「性能与用量」之后：

```
完成与等待提醒                                                              [开关]
回合跑完、或 DSH 在等你批准 / 回答时，只要窗口不在前台就响铃并弹出系统通知。
没人处理的审批 / 提问会在约 2 分钟、6 分钟后再各提醒一次；窗口一回到前台就停。

提醒提示音                                    [完成 ▾]  选择文件…  试听  恢复默认
当前（完成）：内置合成铃音（无音频文件）
再次提醒时加大音量                                                          [开关]
```

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 完成与等待提醒 | 开 | 总开关；打开时会试听一次 |
| 提示音档位 | 完成 | 下拉切换「完成 / 待审批 / 待回答」，每个档位各自保存音源 |
| 选择文件… | — | 选一个音频文件替换当前档位的音源，选完立即试听 |
| 恢复默认 | — | 把当前档位退回内置合成铃音（仅在该档有自定义文件时出现） |
| 再次提醒时加大音量 | 开 | 第 2、3 次提醒按约 1.5 倍、2 倍音量播放；关闭则每次音量相同 |

自定义音源的处理方式：

- 支持浏览器能解码的格式（mp3 / wav / ogg / m4a），单个文件上限 4 MB；
- 只播放前 5 秒，避免误选整首歌后每次提醒都响几分钟；
- 音量按峰值归一化到内置铃音的量级，不会因为文件本身很响而炸耳；
- 新提醒会截断上一段播放，不会叠加；
- 解码失败会明确提示，并**保留原音源**，不会把提醒弄哑。

## 行为细节

**检测方式**：读取 `uiSession.sessionStatus`——侧栏圆点用的同一份每会话状态，字段为 `running` / `pendingInteraction` / `completionUnread`，逐帧比对后触发。这份状态由 Host 通过页面已有连接推送，**不是定时轮询**：隐藏窗口里定时器会被浏览器降频，而推送不会。

| 状态变化 | 行为 |
| --- | --- |
| `pendingInteraction` 出现新请求 | 提醒一次，随后进入 2 / 6 分钟重复链 |
| `running` 由真变假 | 提醒一次（回合完成） |
| `completionUnread` 由假变真 | 提醒一次（不在当前视图里的会话跑完了） |
| 请求被回答 / 被替换 / 状态稳定 | 不提醒，并终止该会话的重复链 |

**重复链的终止条件**（任一满足立即停）：你处理了这条请求、它被同一会话的新请求替换、关闭总开关、窗口回到前台、页面关闭或插件卸载。

**重开接管**：页面打开时已经存在的等待请求不会被当作"基线"忽略，而是重新武装重复链；如果窗口是在后台打开的，会立刻提醒一次。这样"审批待处理 → 关掉应用 → 重开"不会让那条审批从此静音。

**窗口在前台的判断**：`document.hidden || !document.hasFocus()`。

## 数据与隐私

全部设置只留在**这台机器的这个浏览器来源**里，不上传、不发往任何服务：

| 内容 | 位置 | 键 |
| --- | --- | --- |
| 总开关 | `localStorage` | `dsh-harness-orb.reminders` |
| 重复提醒音量递增 | `localStorage` | `dsh-harness-orb.repeat-volume` |
| 三个档位的自定义音源 | `IndexedDB` 的 `dsh-harness-orb` → 存储 `sounds` | `done` / `approval` / `question` |

DSH Desktop 的应用窗口来源是 `dsh-app://app`（不是随机端口），因此这些偏好会在应用重启后保留；用浏览器另开 `127.0.0.1:<端口>` 是另一个来源，偏好独立。

插件本身不读取文件内容、不联网、不写入 profile 配置。

## 兼容性

依赖 DSH 客户端的以下能力，DSH 若调整这些契约，插件可能需要跟着更新：

- 服务：`uiSession`（`sessionStatus`）、`sessions`（会话列表行）、`uiWorkspace`（`openSession`）
- 槽位：`settings.general.item`（设置 → 通用里的单条偏好行）
- 浏览器能力：`Notification`、`AudioContext`、`IndexedDB`

开发与验证环境：DSH Desktop（Windows，profile `desktop`，中文 / 英文界面）。插件未发布到 npm；已安装并确认插件行激活、两行设置注册到设置页，界面的实际渲染观感未做截图记录。

## 已知限制

- **应用关闭期间不会提醒**：没有进程在跑。重复链也随页面结束，重开会从那一刻重新计时。
- **隐藏窗口可能延迟**：重复提醒依赖页面定时器，窗口长时间隐藏时浏览器会把它降频，2 分钟那一次可能晚 1–2 分钟。
- **当前正在查看的会话**不产生"回合完成"提醒——DSH 只把非主视图的停止标记为未读。
- **系统通知需要权限**：权限不可用时只剩提示音，开关那一行的描述会说明；授权提示最多询问两次，不会每次点击都弹。
- **子智能体 / 未在侧栏列出的会话**不提醒。
- 自定义音源显示的是**文件名**：浏览器出于安全不提供完整路径，文件内容保存在本机 IndexedDB 中。

## 卸载

设置 → 插件 → 移除本插件（或关闭开关）即可。两行设置会随之消失，已保存的偏好留在浏览器里，重新安装后继续可用。

## 目录结构

```
dsh-harness-orb/
├── client.js          # 浏览器端：检测、响铃、通知、设置行（全部逻辑）
├── index.js           # Host 端：空实现，仅让 bundle 有一个激活的行
├── cordis.patch.yml   # Loader 补丁：插入 dsh-harness-orb 这一行
├── package.json       # 包声明与 dsh.bundle / dsh.client 清单
├── icon.svg           # 插件图标
├── locale/
│   ├── zh.json        # 插件页显示的中文标题与描述
│   └── en.json        # 英文
└── README.md
```

## 开发

- 无构建步骤：`client.js` 就是最终产物，由 DSH 的客户端模块加载器直接加载。
- 本插件在 profile 里是**链接安装**，改完文件后在插件页关闭再启用，即可让页面加载新代码。
- 提示音是 WebAudio 实时合成的正弦音，没有音频资源文件；三档音型定义在 `playSynth()`，重复提醒的音量档位是 `VOLUME_STEPS = [1, 1.5, 2]`。
- 重复提醒的时间点是 `ESCALATION_DELAYS = [2 * 60 * 1000, 4 * 60 * 1000]`（第一次间隔 2 分钟，之后再过 4 分钟）。

---

## English summary

A reminder plugin for DeepSeek Harness: when a turn finishes, or when DSH is
waiting for your approval or answer, it plays a chime and posts a system
notification — but only while the window is in the background. The notification
names the session, and clicking it focuses the window and opens that session.

An unhandled approval or question is repeated after about two and six minutes,
and stops as soon as you answer, return to the app, or turn reminders off. A
request that was already waiting when the page opened is taken over, so quitting
and reopening the app does not silence it. Each state (finished / approval /
question) has its own sound: the built-in synthesized chime or your own audio
file, with a switch to make repeats louder.

Install by cloning this repository and adding the folder from **Settings →
Plugins → Add plugin**; the two preference rows then appear in **Settings →
General**. Everything is stored locally in the browser (localStorage + IndexedDB)
— nothing leaves the machine.

Limitations: nothing rings while the app is closed; a heavily throttled
background window can delay a repeat by a minute or two; the session you are
currently viewing does not raise a completion reminder.

## 许可证

[MIT](LICENSE) © 2026 ST0new

可自由使用、修改、分发与再授权，保留版权与许可声明即可。

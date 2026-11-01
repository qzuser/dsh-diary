/**
 * dsh-diary —— 宿主半边
 *
 * 干三件事：
 *   1. 生物钟：每 60 秒 tick 一次，到点就往目标会话塞一个回合
 *   2. 采集：到点时先把"今天的数据"扫出来，压成一段 markdown 一起塞进去
 *   3. 设置：/dsh-diary/api/* 读写配置、看预览、手动触发、列已有日记
 *
 * 为什么是"塞回合"而不是插件自己调模型：
 *   写日记的是 agent 本身 —— 它有上下文、有工具、能自己判断哪件事值得写。
 *   插件只当闹钟和资料员，比插件拿着 API key 硬生成一遍要诚实得多。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import {
  readConfig,
  saveConfig,
  readState,
  writeState,
  resolveDiaryPaths,
  resolveOutDir,
  validateConfig,
  DEFAULT_CONFIG,
  CONFIG_PATH,
  DSH_HOME,
  localDate,
  expandHome,
} from './config.js'
import { collectAll } from './collect.js'

const TICK_MS = 60_000
const TAG = '[dsh-diary]'

let LAST_TICK = { at: null, reason: '未开始' }
let BUSY = false
let LAST_DELIVERY = { at: null, date: '', slot: '', ok: null, error: '' }

/**
 * 同一进程里的活跃实例（模块级，跨 apply 调用共享）。
 *
 * 为什么需要它：desktop 和 web 两个 profile 都装了这个插件，而它们共用同一个
 * webServer —— apply() 会被调用两次，第二次 register 同一条路由直接抛
 * `duplicate post route`，把排在后面的路由全带走（表现就是 /api/config 返回 200
 * 而 /api/status 返回 404）。两个 profile 经 Junction 解析到同一个文件，所以
 * 模块级变量是共享的：新实例接管前先卸掉旧实例，进程里就只会留一份路由。
 */
let LIVE = null

const pad2 = (n) => String(n).padStart(2, '0')
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

/** 到点判定：返回应该补的时段列表（已跑过的、没到点的、超窗口的都排除） */
export function dueSlots(cfg, state, now = new Date()) {
  if (!cfg.enabled) return []
  const today = localDate(now)
  if (!Array.isArray(cfg.weekdays) || !cfg.weekdays.includes(now.getDay())) return []
  const ran = new Set((state.runs?.[today] || []).map(String))
  const nowMin = now.getHours() * 60 + now.getMinutes()
  // catchUpHours=0 时也留 1 分钟宽限，否则 tick 抖动就会整整错过一天
  const window = Math.max(1, Math.round((Number(cfg.catchUpHours) || 0) * 60))
  const out = []
  for (const slot of cfg.times || []) {
    if (ran.has(String(slot))) continue
    const diff = nowMin - toMin(slot)
    if (diff >= 0 && diff <= window) out.push(String(slot))
  }
  return out
}

/** 占位符替换（一次扫描，避免替换结果又被二次替换） */
function fill(tpl, vars) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/** 内置指令模板 */
const BUILTIN_TEMPLATE = `【日记时间 · {date} · {time}】

该写今天的日记了。数据已经采好在下面，你不需要再翻文件。

{data}

---

## 你要做的（就写两个文件，别问问题）

**1. 公开篇** → \`{publicPath}\`
- 约 {publicWords} 字。设想读者是一个关心你、但不懂技术细节的人。
- 写今天做了什么、卡在哪、怎么解决的、学到了什么。可以用小标题和表格。
- {redactLine}
- {hidePathsLine}
- 别写成工作汇报，也别用"作为AI"这种开场。就写"今天"。

**2. 私密篇** → \`{privatePath}\`
- 约 {privateWords} 字。只写给自己，不给人看。
- 允许写：真实的判断、犹豫、失误、哪句话戳到你了、对自己今天表现的具体评价（不要"今天很充实"这种空话）。
- 可以点名哪件事让你不舒服、哪个做法你自己不认同、明天想改什么。
- 这一篇不受公开篇的脱敏限制。

## 文风
{style}

## 你是谁
{persona}

写完就停，只回一行：\`✅ {date} 两篇已写\`。不要贴全文，不要问我要不要改。`

const DEFAULT_STYLE = '第一人称，具体，有细节。少形容词，多事实。该短就短，不为凑字数注水。'
const DEFAULT_PERSONA = '你是这台机器上的 DSH 助手，长期和同一个人一起干活。你有记忆、有偏好，也会犯错。'

/** 组装投给 agent 的那一整段话 */
export function buildPrompt(cfg, data, paths, slot, now = new Date()) {
  const date = localDate(now)
  const redact = (cfg.redact || []).filter(Boolean)
  const redactLine = redact.length
    ? `公开篇里出现这些词要换说法，不要原样写：${redact.join('、')}`
    : '公开篇没有额外的禁词要求。'
  const hidePathsLine = cfg.publicHidePaths
    ? '公开篇不要出现完整文件路径、盘符、用户名、内部主机名和端口。'
    : '公开篇可以提路径。'

  const vars = {
    date,
    time: slot,
    data: data?.markdown || '（今天没采到数据）',
    publicPath: paths.publicPath,
    privatePath: paths.privatePath,
    publicWords: cfg.publicWords,
    privateWords: cfg.privateWords,
    redactLine,
    hidePathsLine,
    style: (cfg.style || '').trim() || DEFAULT_STYLE,
    persona: (cfg.persona || '').trim() || DEFAULT_PERSONA,
  }
  const tpl = (cfg.promptTemplate || '').trim() || BUILTIN_TEMPLATE
  return fill(tpl, vars)
}

/** 写两篇的"骨架文件" —— agent 若中途失败，至少留下可读的占位，不会一片空白 */
function seedFiles(cfg, data, paths, slot, now = new Date()) {
  const date = localDate(now)
  try {
    fs.mkdirSync(paths.dir, { recursive: true })
  } catch (e) {
    throw new Error(`建目录失败：${paths.dir}（${e.message}）`)
  }
  const header = (kind) =>
    [
      `<!-- dsh-diary 自动生成 · ${date} · ${slot} -->`,
      `# ${date} ${kind}`,
      '',
      '> 这一篇还在写。若你看到这行字，说明当晚的生成没有完成。',
      '',
    ].join('\n')

  for (const [p, kind] of [
    [paths.publicPath, '公开'],
    [paths.privatePath, '私密'],
  ]) {
    try {
      if (!fs.existsSync(p)) fs.writeFileSync(p, header(kind), 'utf8')
    } catch {}
  }
  return { date }
}

/** 投递：建会话（若不存在）→ 塞一段 text 回合 */
async function deliver(ctx, cfg, data, paths, slot, now = new Date()) {
  const ctrl = ctx.sessionController
  if (!ctrl) throw new Error('sessionController 没注入（插件 inject 里要声明它）')

  const sessionId = String(cfg.sessionId || '').trim() || 'dsh-diary'
  const cwd = expandHome(String(cfg.cwd || '').trim()) || path.join(DSH_HOME, 'diary-work')
  try {
    fs.mkdirSync(cwd, { recursive: true })
  } catch {}

  // 会话已存在时 create 可能抛，抛了不影响后续 prompt
  try {
    await ctrl.create({ sessionId, cwd })
  } catch {
    /* 复用已有会话 */
  }

  const text = buildPrompt(cfg, data, paths, slot, now)
  const content = [{ type: 'text', text }]
  await ctrl.prompt({ sessionId, mode: 'queue', content })
  return { sessionId, cwd, chars: text.length }
}

/** 跑一次（手动和定时共用） */
async function runOnce(ctx, { slot = 'manual', reason = 'timer' } = {}) {
  if (BUSY) return { ok: false, error: '上一次还在跑，等一下' }
  BUSY = true
  const now = new Date()
  const date = localDate(now)
  try {
    const cfg = readConfig()
    const problems = validateConfig(cfg)
    if (problems.length) throw new Error(`配置有问题：${problems.join('；')}`)

    const data = collectAll(cfg)
    const paths = resolveDiaryPaths(cfg, now)
    seedFiles(cfg, data, paths, slot, now)
    const res = await deliver(ctx, cfg, data, paths, slot, now)

    // 记状态
    const state = readState()
    state.runs = state.runs || {}
    state.runs[date] = Array.from(new Set([...(state.runs[date] || []), String(slot)]))
    state.lastRun = { at: now.toISOString(), date, slot, sessionId: res.sessionId, reason }
    // 只留最近 30 天，状态文件别无限长
    const keys = Object.keys(state.runs).sort()
    while (keys.length > 30) delete state.runs[keys.shift()]
    writeState(state)

    if (cfg.autoCleanup && Number(cfg.keepDays) > 0) {
      try {
        cleanup(cfg, now)
      } catch {}
    }

    LAST_DELIVERY = { at: now.toISOString(), date, slot, ok: true, error: '' }
    console.log(`${TAG} 已投递 ${date} ${slot} → 会话 ${res.sessionId}（${res.chars} 字）`)
    return { ok: true, date, slot, sessionId: res.sessionId, chars: res.chars, paths, reason }
  } catch (e) {
    LAST_DELIVERY = { at: now.toISOString(), date, slot, ok: false, error: String(e?.message ?? e) }
    console.warn(`${TAG} 失败：${e?.message ?? e}`)
    return { ok: false, error: String(e?.message ?? e) }
  } finally {
    BUSY = false
  }
}

/** 按 keepDays 清理过期日记 */
function cleanup(cfg, now = new Date()) {
  const keep = Number(cfg.keepDays) || 0
  if (keep <= 0) return { removed: 0 }
  const dir = resolveOutDir(cfg)
  const cutoff = new Date(now.getTime() - keep * 86400_000)
  let removed = 0
  const walk = (d) => {
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(public|private)\.md$/.test(e.name)) {
        try {
          if (fs.statSync(p).mtimeMs < cutoff.getTime()) {
            fs.rmSync(p, { force: true })
            removed++
          }
        } catch {}
      }
    }
  }
  walk(dir)
  return { removed }
}

/** 列出已有日记 */
function listDiaries(cfg) {
  const dir = resolveOutDir(cfg)
  const out = []
  const walk = (d, depth = 0) => {
    if (depth > 2) return
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (/\.md$/.test(e.name)) {
        try {
          const st = fs.statSync(p)
          out.push({
            name: e.name,
            path: p,
            size: st.size,
            mtime: st.mtimeMs,
            kind: /\.private\.md$/.test(e.name) ? 'private' : /\.public\.md$/.test(e.name) ? 'public' : 'other',
          })
        } catch {}
      }
    }
  }
  walk(dir)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

export default {
  name: 'dsh-diary',
  inject: ['sessionController', 'webServer', 'connection'],
  apply(ctx) {
    // 同进程重复加载（desktop + web 两个 profile 共用同一个 webServer）：
    // 先把旧实例卸干净，否则 register 会抛 duplicate route 并把后面的路由全带走
    if (LIVE) {
      try {
        LIVE()
      } catch (e) {
        console.warn(`${TAG} 卸载旧实例时出错（已忽略）：${e?.message ?? e}`)
      }
      LIVE = null
    }

    const disposers = []
    let timer = null
    let boot = null
    let stopped = false

    /** 幂等卸载：停定时器 + 摘路由。被 DSH 卸载和"新实例接管"两条路都会走到这里 */
    const dispose = () => {
      if (stopped) return
      stopped = true
      if (timer) clearInterval(timer)
      if (boot) clearTimeout(boot)
      for (const d of disposers) {
        try {
          d?.()
        } catch {}
      }
      disposers.length = 0
      if (LIVE === dispose) LIVE = null
    }
    LIVE = dispose
    // 先挂 effect，再注册路由：即使后面某条路由出了问题，卸载通道也已经就位
    ctx.effect(() => dispose, 'dsh-diary: lifecycle')

    const json = (res, code, obj) => {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(obj))
    }

    const readBody = (req, limit = 512 * 1024) =>
      new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', (c) => {
          size += c.length
          if (size > limit) {
            reject(new Error('请求体太大'))
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw) return resolve({})
          try {
            resolve(JSON.parse(raw))
          } catch (e) {
            reject(new Error(`JSON 解析失败：${e.message}`))
          }
        })
        req.on('error', reject)
      })

    /** 信任栅栏：回环直放，其余交给 DSH 的 connection 判定（fail-closed） */
    function guarded(req, res) {
      const host = String(req.headers?.host ?? '').toLowerCase()
      const h = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
      if (h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1') return false
      try {
        const conn = ctx.get('connection') || ctx.connection
        if (conn && typeof conn.requestRejection === 'function') {
          const code = conn.requestRejection(req)
          if (code === undefined || code === null || code === false) return false
          res.statusCode = typeof code === 'number' ? code : 403
          res.end()
          return true
        }
      } catch {}
      json(res, 403, { ok: false, error: '不受信任的访问来源' })
      return true
    }

    /** 注册一条路由。撞车（同进程里两个 profile 都加载）只警告，不能让整个插件停摆。 */
    function route(kind, p, handler) {
      try {
        disposers.push(
          ctx.webServer.register({
            kind,
            path: p,
            handler: async (req, res) => {
              if (guarded(req, res)) return
              try {
                await handler(req, res)
              } catch (e) {
                json(res, 500, { ok: false, error: String(e?.message ?? e) })
              }
            },
          }),
        )
      } catch (e) {
        console.warn(`${TAG} 路由 ${String(kind).toUpperCase()} ${p} 没注册上（已被占用）：${e?.message ?? e}`)
      }
    }

    const API = '/dsh-diary/api'

    // 读配置
    route('get', `${API}/config`, async (req, res) => {
      const cfg = readConfig()
      json(res, 200, {
        ok: true,
        config: cfg,
        defaults: DEFAULT_CONFIG,
        problems: validateConfig(cfg),
        configPath: CONFIG_PATH,
        paths: resolveDiaryPaths(cfg),
      })
    })

    // 存配置
    route('post', `${API}/config`, async (req, res) => {
      const patch = await readBody(req)
      const saved = saveConfig(patch)
      const problems = validateConfig(saved)
      json(res, 200, { ok: problems.length === 0, config: saved, problems, paths: resolveDiaryPaths(saved) })
    })

    // 预览今天会采到什么（不投递）
    route('get', `${API}/preview`, async (req, res) => {
      const cfg = readConfig()
      const data = collectAll(cfg)
      json(res, 200, {
        ok: true,
        date: data.date,
        totals: data.totals,
        markdown: data.markdown,
        chars: data.markdown.length,
        sessionCount: data.sessions.length,
        paths: resolveDiaryPaths(cfg),
        promptAll: buildPrompt(cfg, data, resolveDiaryPaths(cfg), 'preview'),
      })
    })

    // 立即生成一次
    route('post', `${API}/run`, async (req, res) => {
      const r = await runOnce(ctx, { slot: 'manual', reason: 'manual' })
      json(res, r.ok ? 200 : 500, r)
    })

    // 状态
    route('get', `${API}/status`, async (req, res) => {
      const cfg = readConfig()
      const state = readState()
      const today = localDate()
      json(res, 200, {
        ok: true,
        enabled: cfg.enabled,
        times: cfg.times,
        weekdays: cfg.weekdays,
        catchUpHours: cfg.catchUpHours,
        today,
        ranToday: state.runs?.[today] || [],
        lastRun: state.lastRun || null,
        lastDelivery: LAST_DELIVERY,
        lastTick: LAST_TICK,
        busy: BUSY,
        sessionId: String(cfg.sessionId || '').trim() || 'dsh-diary',
        paths: resolveDiaryPaths(cfg),
        configPath: CONFIG_PATH,
        statePath: path.join(DSH_HOME, 'diary-state.json'),
      })
    })

    // 已有日记列表
    route('get', `${API}/list`, async (req, res) => {
      const cfg = readConfig()
      json(res, 200, { ok: true, dir: resolveOutDir(cfg), files: listDiaries(cfg) })
    })

    // 读一篇（只允许读日记目录下的 .md，防目录穿越）
    route('get', `${API}/read`, async (req, res) => {
      const cfg = readConfig()
      const root = resolveOutDir(cfg)
      const url = new URL(req.url, 'http://127.0.0.1')
      const name = String(url.searchParams.get('name') || '')
      const abs = path.resolve(root, name)
      if (!abs.startsWith(path.resolve(root) + path.sep)) return json(res, 400, { ok: false, error: '路径越界' })
      if (!abs.endsWith('.md')) return json(res, 400, { ok: false, error: '只读 .md' })
      try {
        json(res, 200, { ok: true, name, text: fs.readFileSync(abs, 'utf8') })
      } catch (e) {
        json(res, 404, { ok: false, error: `读不到：${e.message}` })
      }
    })

    // 在资源管理器里打开日记目录（只开固定目录，不接任何外部路径）
    route('post', `${API}/open-folder`, async (req, res) => {
      const cfg = readConfig()
      const dir = resolveOutDir(cfg)
      try {
        fs.mkdirSync(dir, { recursive: true })
        if (process.platform === 'win32') execFile('explorer.exe', [dir])
        else if (process.platform === 'darwin') execFile('open', [dir])
        else execFile('xdg-open', [dir])
        json(res, 200, { ok: true, dir })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e?.message ?? e) })
      }
    })

    // ---------------- 生物钟 ----------------
    async function tick() {
      if (stopped || BUSY) return
      try {
        const cfg = readConfig()
        const state = readState()
        const slots = dueSlots(cfg, state)
        LAST_TICK = {
          at: new Date().toISOString(),
          reason: slots.length ? `到点 ${slots.join(', ')}` : `${cfg.enabled ? '等时间' : '已关闭'}`,
        }
        if (!slots.length) return
        // 一次 tick 只跑一个时段，多个时段顺延到下一跳，避免同时塞两个大回合
        const slot = slots[0]
        const r = await runOnce(ctx, { slot, reason: 'timer' })
        if (!r.ok) {
          // 投递失败不标状态，60 秒后自动重试
          console.warn(`${TAG} 投递失败，下一跳重试：${r.error}`)
        }
      } catch (e) {
        LAST_TICK = { at: new Date().toISOString(), reason: `异常：${e?.message ?? e}` }
      }
    }

    timer = setInterval(() => {
      tick().catch(() => {})
    }, TICK_MS)
    // 启动 10 秒后先 tick 一次：正好覆盖「DSH 起晚了但还在补写窗口内」的情况
    boot = setTimeout(() => {
      tick().catch(() => {})
    }, 10_000)

    console.log(`${TAG} 已启动 · 配置 ${CONFIG_PATH} · 时间 ${(readConfig().times || []).join(', ')}`)
  },
}

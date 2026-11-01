/**
 * dsh-diary —— 配置层
 *
 * 设计原则：**默认值只管"能跑起来"，一切想改的东西都摊在配置里**。
 * 所有键都能从设置页改，也能直接手改 ~/.dsh/diary-config.json（改完下一跳生效，
 * 不需要重启 DSH）。
 *
 * 读配置永远返回"默认值 + 用户配置"的深合并结果 —— 用户删掉某个键就自动回默认，
 * 不会因为少一个字段就崩。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const CONFIG_PATH = path.join(DSH_HOME, 'diary-config.json')
export const STATE_PATH = path.join(DSH_HOME, 'diary-state.json')
export const SESSIONS_DIR = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')

/** 日记默认落点：~/.dsh/diary/ */
export const DEFAULT_OUT_DIR = path.join(DSH_HOME, 'diary')

/**
 * 全部可配置项。每一项都在设置页有一行，也都能写进 JSON。
 * 注释里的「可关」意思是：设成 false 就真的不采、不写，不是"软开关"。
 */
export const DEFAULT_CONFIG = {
  // ---- 什么时候写 ----
  enabled: true,
  /** 一天可以跑多次，如 ["22:00"] 或 ["12:30", "22:00"]；24 小时制 HH:MM */
  times: ['22:00'],
  /** 哪几天写；0=周日 … 6=周六。默认每天 */
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  /** 错过时间点后，多少小时内还补写（0 = 不补） */
  catchUpHours: 6,

  // ---- 谁来写 ----
  /** 目标会话 id；留空则自动建一个专用会话（建议留空，免得污染你正在聊的会话） */
  sessionId: '',
  /** 该会话的工作目录；留空用 ~/.dsh/diary-work */
  cwd: '',
  /** 模型覆盖；留空用会话默认。填法与会话内一致，如 "deepseek-chat" */
  model: '',

  // ---- 写到哪 ----
  /** 输出目录；支持 ~ 展开。留空 = ~/.dsh/diary */
  outDir: '',
  /** 文件名模板，可用占位符：{date} {yyyy} {mm} {dd} {weekday} {iso} */
  publicPattern: '{date}.public.md',
  privatePattern: '{date}.private.md',
  /** 两篇是否放同一个月度子目录（{yyyy}-{mm}/） */
  monthlyDir: false,
  /** 每篇前面是否加一行元信息（时间、数据源、token 数） */
  appendHeader: true,

  // ---- 写成什么样 ----
  /** 公开篇目标字数（软约束，写进指令里） */
  publicWords: 700,
  /** 私密篇目标字数 */
  privateWords: 1000,
  /** 文风指令，直接拼进 prompt。留空用内置默认文风 */
  style: '',
  /** 人设补充：让写日记的那个"自己"知道它是谁 */
  persona: '',
  /** 公开篇必须抹掉的词（大小写不敏感）。命中即要求 agent 换说法 */
  redact: ['token', 'api_key', 'apikey', 'secret', 'password', '密码', 'cookie', 'sk-', 'Bearer'],
  /** 公开篇是否要求"不提具体文件名/路径" */
  publicHidePaths: true,

  // ---- 采哪些数据 ----
  sources: {
    /** 会话标题 + 工作目录 */
    sessions: true,
    /** 每轮的用户提问 + 回复摘要（信息量最大的一项） */
    turnOutline: true,
    /** 轮次/步数/耗时/decode token */
    stats: true,
    /** 未完成的 todo */
    todos: true,
    /** 子代理调用记录 */
    subagents: true,
    /** 鲸鱼（B站）活动日志 */
    whaleLog: true,
    /** 其他插件的产物（飞鱼心情、鱼记忆等，只读轻量文件） */
    plugins: true,
    /** DSH 运行日志（体积大，默认关） */
    logs: false,
  },
  /** 最多取几个会话（按最后修改时间倒序） */
  maxSessions: 12,
  /** 每个会话最多取几轮 */
  maxTurnsPerSession: 12,
  /** 每轮 prompt / response 各截多少字 */
  maxPromptChars: 160,
  maxResponseChars: 260,
  /** 日志最多读多少行（sources.logs 打开时有效） */
  maxLogLines: 200,
  /** 喂给 agent 的数据摘要总字数上限（超了硬截断，防止 prompt 撑爆上下文） */
  maxDataChars: 6000,

  // ---- 完全自定义 ----
  /**
   * 自定义指令模板。留空用内置模板。
   * 可用占位符：{date} {publicPath} {privatePath} {publicWords} {privateWords}
   *            {style} {persona} {redact} {data}
   */
  promptTemplate: '',

  // ---- 归档 ----
  /** 保留多少天；0 = 永久保留 */
  keepDays: 0,
  /** 跑完是否顺手清理过期日记 */
  autoCleanup: true,
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

/** 深合并：用户配置覆盖默认值；用户没写的键保留默认 */
export function mergeConfig(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(out[k])) out[k] = mergeConfig(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out
}

export function readConfigRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

export function readConfig() {
  return mergeConfig(DEFAULT_CONFIG, readConfigRaw())
}

/** 原子写：先写 tmp 再 rename，避免 DSH 崩在半截留下坏 JSON */
export function writeConfigFile(obj) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const tmp = `${CONFIG_PATH}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
    fs.renameSync(tmp, CONFIG_PATH)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/**
 * 保存配置：**按用户提交的整份覆盖写**，但和默认值合并后再落盘，
 * 这样手改 JSON 加的自定义键不会被设置页冲掉（未知键原样保留）。
 */
export function saveConfig(patch) {
  const current = readConfigRaw()
  const next = mergeConfig(current, patch || {})
  writeConfigFile(next)
  return mergeConfig(DEFAULT_CONFIG, next)
}

// ---------------- 状态（今天跑过没有） ----------------

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    if (s && typeof s === 'object') return { runs: {}, ...s }
  } catch {}
  return { runs: {} }
}

export function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  const tmp = `${STATE_PATH}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, STATE_PATH)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// ---------------- 路径处理 ----------------

export function expandHome(p) {
  if (!p) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function resolveOutDir(cfg) {
  const raw = expandHome(String(cfg.outDir || '').trim())
  return raw ? path.resolve(raw) : DEFAULT_OUT_DIR
}

/** 本地日期 YYYY-MM-DD（不受 UTC 影响） */
export function localDate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 把文件模板渲染成文件名 */
export function renderName(pattern, d = new Date()) {
  const date = localDate(d)
  const [y, m, dd] = date.split('-')
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return String(pattern || '{date}.md')
    .replaceAll('{date}', date)
    .replaceAll('{yyyy}', y)
    .replaceAll('{mm}', m)
    .replaceAll('{dd}', dd)
    .replaceAll('{weekday}', wd)
    .replaceAll('{iso}', d.toISOString())
}

/** 两篇日记的最终绝对路径 */
export function resolveDiaryPaths(cfg, d = new Date()) {
  const root = resolveOutDir(cfg)
  let dir = root
  if (cfg.monthlyDir) {
    const [y, m] = localDate(d).split('-')
    dir = path.join(root, `${y}-${m}`)
  }
  return {
    dir,
    publicPath: path.join(dir, renderName(cfg.publicPattern, d)),
    privatePath: path.join(dir, renderName(cfg.privatePattern, d)),
  }
}

/** 配置校验：返回问题数组，空数组 = 没问题 */
export function validateConfig(cfg) {
  const problems = []
  if (!Array.isArray(cfg.times) || cfg.times.length === 0) problems.push('times 至少要有一个时间点')
  for (const t of cfg.times || []) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t))) problems.push(`时间格式不对：${t}（要 HH:MM）`)
  }
  if (!Array.isArray(cfg.weekdays) || cfg.weekdays.length === 0) problems.push('weekdays 不能为空')
  for (const w of cfg.weekdays || []) {
    if (!Number.isInteger(w) || w < 0 || w > 6) problems.push(`weekdays 里有非法值：${w}`)
  }
  if (!(Number(cfg.publicWords) >= 0)) problems.push('publicWords 要是非负数字')
  if (!(Number(cfg.privateWords) >= 0)) problems.push('privateWords 要是非负数字')
  if (!Array.isArray(cfg.redact)) problems.push('redact 要是数组')
  return problems
}

/**
 * dsh-diary —— 数据采集层
 *
 * 目标：把「今天在这台机器上到底发生了什么」压成一份 agent 能直接读的文本。
 *
 * 数据来自三处，全部**只读**：
 *   1. ~/.dsh/storages/session_projcache/sessions/*.json —— 会话元数据 + 每轮问答摘要
 *   2. ~/.dsh/whale-log.jsonl 等插件产物 —— 其他 agent 今天干了什么
 *   3. ~/.dsh/logs/*.log（可选，默认关）—— 运行日志尾巴
 *
 * 刻意**不做**的事：不去解 zstd 完整对话（体积大、收益小），不猜各插件的 JSON 结构
 * （只按"今天改过的文件 + 前 N 字节"通用摘录，插件升级也不会让这里崩）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DSH_HOME, SESSIONS_DIR, localDate } from './config.js'

const clamp = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function isToday(stat) {
  try {
    return stat.mtimeMs >= startOfToday()
  } catch {
    return false
  }
}

/** rows[key].val 的取值器（DSH 的 rows 是 {key: {ver, seq, val}}） */
function rowVal(rows, key) {
  const r = rows?.[key]
  if (r && typeof r === 'object' && 'val' in r) return r.val
  return r
}

/** 单个会话 → 结构化摘要；任何异常都返回 null，不让一个坏文件拖垮整篇日记 */
function readSession(file) {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const rows = raw?.record?.rows || {}
  const identity = raw?.record?.identity || {}
  const stats = rowVal(rows, 'sessionStats') || {}
  const usage = rowVal(rows, 'tokenUsage') || {}
  const outline = rowVal(rows, 'turnOutline')?.turns || []
  const todos = rowVal(rows, 'todos')
  const subagent = rowVal(rows, 'subagent')
  const title = rowVal(rows, 'title')
  const cwd = rowVal(rows, 'workingDirectory') || identity.cwd || ''

  const id = path.basename(file, '.json')

  // todos 可能是 {items:[...]} 或数组，统一抠出未完成项
  let openTodos = []
  const todoArr = Array.isArray(todos) ? todos : Array.isArray(todos?.items) ? todos.items : []
  openTodos = todoArr
    .filter((t) => t && (t.status === 'pending' || t.status === 'in_progress' || t.done === false))
    .map((t) => clamp(t.content || t.text || t.title || '', 80))
    .filter(Boolean)
    .slice(0, 6)

  const subKeys = subagent && typeof subagent === 'object' ? Object.keys(subagent) : []

  return {
    id,
    title: typeof title === 'string' ? title : '',
    cwd,
    turns: Number(stats.turns) || outline.length || 0,
    steps: Number(stats.steps) || 0,
    llmMs: Number(stats.llmMs) || 0,
    toolMs: Number(stats.toolMs) || 0,
    decodeTokens: Number(stats.decodeTokens) || 0,
    tokensIn: Number(usage?.totals?.uncachedInputTokens) || 0,
    tokensOut: Number(usage?.totals?.outputTokens) || 0,
    cacheRead: Number(usage?.totals?.cacheReadTokens) || 0,
    outline,
    openTodos,
    subagentCount: subKeys.length,
    mtime: fs.statSync(file).mtimeMs,
  }
}

/** 今天活跃过的会话，按最后修改倒序 */
export function collectSessions(cfg) {
  const dir = SESSIONS_DIR
  let files = []
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f.startsWith('session-'))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try {
          return isToday(fs.statSync(f))
        } catch {
          return false
        }
      })
  } catch {
    return []
  }

  const list = files.map(readSession).filter(Boolean)
  list.sort((a, b) => b.mtime - a.mtime)
  return list.slice(0, Math.max(1, Number(cfg.maxSessions) || 12))
}

/** 今天的 whale-log.jsonl（另一个 agent 的活动） */
export function collectWhaleLog() {
  const p = path.join(DSH_HOME, 'whale-log.jsonl')
  const today = localDate()
  const out = []
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const s = line.trim()
      if (!s) continue
      if (!s.includes(today)) continue
      try {
        const j = JSON.parse(s)
        out.push({
          at: j.at || j.time || '',
          kind: j.kind || j.type || '',
          text: clamp(j.text || j.summary || j.message || '', 120),
        })
      } catch {
        out.push({ at: '', kind: '', text: clamp(s, 120) })
      }
    }
  } catch {}
  return out.slice(-40)
}

/**
 * 其他插件的产物：通用摘录。
 * 不解析结构 —— 只挑今天改过的小文件，取前若干字符。
 * 这样任何插件升级/换 schema 都不会让采集崩，也不会误读大文件。
 */
export function collectPluginArtifacts(cfg) {
  const candidates = [
    { name: '飞鱼心情', p: path.join(DSH_HOME, 'feiyu-mood') },
    { name: '鱼记忆', p: path.join(DSH_HOME, 'fish-memory') },
    { name: '鲸鱼夜计划', p: path.join(DSH_HOME, 'whale-night.json') },
    { name: '鲸鱼用量', p: path.join(DSH_HOME, '.dshw-usage.json') },
    { name: '鲸鱼回合', p: path.join(DSH_HOME, '.dshw-turn.json') },
    { name: 'B站配置', p: path.join(DSH_HOME, 'bili-whale.config.json') },
  ]
  const out = []
  for (const c of candidates) {
    try {
      const st = fs.statSync(c.p)
      if (st.isDirectory()) {
        const inner = fs
          .readdirSync(c.p)
          .map((f) => path.join(c.p, f))
          .filter((f) => {
            try {
              const s = fs.statSync(f)
              return s.isFile() && s.size < 200_000 && isToday(s)
            } catch {
              return false
            }
          })
        for (const f of inner.slice(0, 3)) {
          const txt = fs.readFileSync(f, 'utf8')
          out.push({ name: `${c.name}/${path.basename(f)}`, text: clamp(txt, 220) })
        }
      } else if (st.isFile() && st.size < 200_000 && isToday(st)) {
        out.push({ name: c.name, text: clamp(fs.readFileSync(c.p, 'utf8'), 220) })
      }
    } catch {}
  }
  return out
}

/** 今天的日志尾巴（默认关） */
export function collectLogs(cfg) {
  const dir = path.join(DSH_HOME, 'logs')
  const today = localDate()
  const out = []
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try {
          return isToday(fs.statSync(f))
        } catch {
          return false
        }
      })
    const maxLines = Math.max(10, Number(cfg.maxLogLines) || 200)
    for (const f of files.slice(0, 3)) {
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
      const tail = lines.slice(-Math.ceil(maxLines / files.length))
      out.push({ file: path.basename(f), lines: tail.map((l) => clamp(l, 160)) })
    }
    // 只保留今天的行（日志文件可能跨天）
    for (const group of out) group.lines = group.lines.filter((l) => l.includes(today) || !/^\d{4}-\d{2}-\d{2}/.test(l))
  } catch {}
  return out
}

const ms2min = (ms) => `${Math.round((Number(ms) || 0) / 60000)}min`
const kNum = (n) => {
  const v = Number(n) || 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

/**
 * 采样 + 组装。返回结构化数据 + 给 agent 读的 markdown。
 * markdown 会按 cfg.maxDataChars 硬截断 —— prompt 不能无限长。
 */
export function collectAll(cfg) {
  const date = localDate()
  const src = cfg.sources || {}
  const sessions = src.sessions || src.turnOutline ? collectSessions(cfg) : []
  const whale = src.whaleLog ? collectWhaleLog() : []
  const plugins = src.plugins ? collectPluginArtifacts(cfg) : []
  const logs = src.logs ? collectLogs(cfg) : []

  const totals = { sessions: sessions.length, turns: 0, steps: 0, decodeTokens: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, llmMs: 0, toolMs: 0 }
  for (const s of sessions) {
    totals.turns += s.turns
    totals.steps += s.steps
    totals.decodeTokens += s.decodeTokens
    totals.tokensIn += s.tokensIn
    totals.tokensOut += s.tokensOut
    totals.cacheRead += s.cacheRead
    totals.llmMs += s.llmMs
    totals.toolMs += s.toolMs
  }

  // ---- 组装 markdown ----
  const L = []
  L.push(`## 今天的原始数据（${date}）`)
  L.push('')
  L.push(
    `**总量**：${totals.sessions} 个会话 · ${totals.turns} 个回合 · ${totals.steps} 步 · 输出 ${kNum(totals.decodeTokens)} token · 模型耗时 ${ms2min(totals.llmMs)} · 工具耗时 ${ms2min(totals.toolMs)}`,
  )
  L.push('')

  if (sessions.length === 0) {
    L.push('_今天没有任何会话记录。_')
    L.push('')
  }

  let i = 1
  for (const s of sessions) {
    L.push(`### ${i++}. ${s.title || '(无标题会话)'}`)
    const bits = []
    if (s.turns) bits.push(`${s.turns} 回合`)
    if (s.steps) bits.push(`${s.steps} 步`)
    if (s.decodeTokens) bits.push(`${kNum(s.decodeTokens)} token`)
    if (s.llmMs) bits.push(`模型 ${ms2min(s.llmMs)}`)
    if (s.toolMs) bits.push(`工具 ${ms2min(s.toolMs)}`)
    if (s.subagentCount) bits.push(`${s.subagentCount} 个子代理`)
    if (bits.length) L.push(`- 规模：${bits.join(' · ')}`)
    if (s.cwd) L.push(`- 目录：\`${s.cwd}\``)

    if (src.turnOutline && s.outline.length) {
      L.push('- 今天聊了什么：')
      const turns = s.outline.slice(-Math.max(1, Number(cfg.maxTurnsPerSession) || 12))
      for (const t of turns) {
        const p = clamp(t.prompt, Number(cfg.maxPromptChars) || 160)
        const r = clamp(t.response, Number(cfg.maxResponseChars) || 260)
        L.push(`  - **问**（第 ${t.turn} 轮）：${p}`)
        if (r) L.push(`    **答**：${r}`)
      }
    }
    if (src.todos && s.openTodos.length) {
      L.push(`- 还压着的事：${s.openTodos.map((x) => `「${x}」`).join('、')}`)
    }
    L.push('')
  }

  if (whale.length) {
    L.push('### 另一边：鲸鱼今天做了什么')
    for (const w of whale.slice(-20)) {
      L.push(`- ${w.at ? `[${w.at}] ` : ''}${w.kind ? `${w.kind}：` : ''}${w.text}`)
    }
    L.push('')
  }

  if (plugins.length) {
    L.push('### 其他插件的痕迹（原文摘录）')
    for (const p of plugins) L.push(`- **${p.name}**：${p.text}`)
    L.push('')
  }

  if (logs.length) {
    L.push('### 运行日志尾巴')
    for (const g of logs) {
      L.push(`**${g.file}**`)
      for (const line of g.lines.slice(-30)) L.push(`\`${line}\``)
      L.push('')
    }
  }

  let markdown = L.join('\n')
  const cap = Math.max(1000, Number(cfg.maxDataChars) || 6000)
  if (markdown.length > cap) markdown = `${markdown.slice(0, cap)}\n\n…（数据超长，已截断）`

  return { date, generatedAt: new Date().toISOString(), totals, sessions, whale, plugins, logs, markdown }
}

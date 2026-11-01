/**
 * dsh-diary —— 客户端半边：DSH 设置 → 日记
 *
 * 数据驱动：FIELDS 是唯一真相，加字段只改这个数组（wide: true = 占整行）。
 * 支持点路径（如 sources.sessions）直接读写嵌套配置。
 * 保存时提交**整份**配置（load 回来只改几个键），手写在 JSON 里的自定义键不会被抹掉。
 */
window.__ModuleLoader__.load({
  id: 'dsh-diary',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useMemo, useState } = React

    const API = '/dsh-diary/api'
    const NS = 'diary'
    const WEEK = ['日', '一', '二', '三', '四', '五', '六']

    const CSS_TAG = 'dsh-diary/section.css'
    const CSS = [
      // ---------- 外框 ----------
      '.ddy{display:flex;flex-direction:column;gap:14px;max-width:760px;font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5}',

      // ---------- 头部 ----------
      '.ddy-head{display:flex;align-items:flex-start;gap:16px}',
      '.ddy-head-main{flex:1;min-width:0}',
      '.ddy-h1{margin:0;font-size:17px;font-weight:600;letter-spacing:.2px;line-height:24px}',
      '.ddy-sub{margin:5px 0 0;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-tertiary)}',
      '.ddy-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;font-size:11.5px;font-weight:500;white-space:nowrap;flex:none;border:1px solid transparent}',
      '.ddy-pill.on{color:#2f8f3d;background:rgba(63,163,77,.12);border-color:rgba(63,163,77,.3)}',
      '.ddy-pill.off{color:var(--dsw-alias-label-tertiary);background:rgba(127,127,127,.1);border-color:rgba(127,127,127,.2)}',
      '.ddy-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}',

      // ---------- 状态三格 ----------
      '.ddy-stat{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
      '.ddy-stat>div{padding:11px 13px;border-radius:11px;background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.06);min-width:0}',
      '.ddy-k{font-size:10.5px;letter-spacing:.6px;color:var(--dsw-alias-label-tertiary);margin-bottom:5px}',
      '.ddy-v{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

      // ---------- 卡片分组 ----------
      '.ddy-card{border:1px solid var(--dsw-alias-border-l2);border-radius:13px;overflow:hidden}',
      '.ddy-card>header{display:flex;align-items:center;gap:9px;padding:11px 15px;background:rgba(127,127,127,.05);border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.ddy-card>header h4{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.3px}',
      '.ddy-card>header .ddy-tagline{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.ddy-body{padding:0 15px}',

      // ---------- 行 ----------
      '.ddy-row{display:flex;align-items:center;gap:18px;min-height:46px;padding:11px 0;border-bottom:1px solid rgba(127,127,127,.11)}',
      '.ddy-row:last-child{border-bottom:none}',
      '.ddy-row.wide{flex-direction:column;align-items:stretch;gap:9px}',
      '.ddy-meta{flex:1;min-width:0}',
      '.ddy-label{font-size:12.5px;line-height:18px}',
      '.ddy-hint{margin-top:3px;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:pre-line}',
      '.ddy-ctl{flex:none;display:flex;align-items:center;gap:8px}',
      '.ddy-row.wide .ddy-ctl{width:100%}',

      // ---------- 输入 ----------
      '.ddy-in{height:31px;width:236px;max-width:100%;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:rgba(127,127,127,.05);color:inherit;font-family:inherit;font-size:12.5px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s}',
      '.ddy-in:hover{border-color:rgba(127,127,127,.45)}',
      '.ddy-in:focus{border-color:var(--dsw-alias-brand-primary);background:rgba(127,127,127,.02);box-shadow:0 0 0 3px rgba(99,102,241,.15)}',
      '.ddy-in.num{width:84px;text-align:right;font-variant-numeric:tabular-nums}',
      '.ddy-in.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}',
      '.ddy-ta{width:100%;min-height:64px;padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:rgba(127,127,127,.05);color:inherit;font-family:inherit;font-size:12px;line-height:18px;resize:vertical;outline:none;transition:border-color .15s,box-shadow .15s}',
      '.ddy-ta.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:17px}',
      '.ddy-ta:hover{border-color:rgba(127,127,127,.45)}',
      '.ddy-ta:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px rgba(99,102,241,.15)}',

      // ---------- 开关 ----------
      '.ddy-sw{position:relative;width:38px;height:22px;flex:none;padding:0;border:none;border-radius:999px;background:rgba(127,127,127,.35);cursor:pointer;transition:background .18s}',
      '.ddy-sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .18s}',
      '.ddy-sw.on{background:var(--dsw-alias-brand-primary)}',
      '.ddy-sw.on::after{transform:translateX(16px)}',
      '.ddy-sw:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(99,102,241,.3)}',

      // ---------- 星期 ----------
      '.ddy-wd{display:flex;gap:6px;flex-wrap:wrap}',
      '.ddy-wd button{width:35px;height:31px;padding:0;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:rgba(127,127,127,.04);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}',
      '.ddy-wd button:hover{border-color:rgba(127,127,127,.5)}',
      '.ddy-wd button.on{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}',

      // ---------- 按钮 ----------
      '.ddy-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:2px}',
      '.ddy-btn{height:32px;padding:0 15px;border-radius:9px;border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff);font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:filter .15s,background .15s,transform .06s;white-space:nowrap}',
      '.ddy-btn:hover:not(:disabled){filter:brightness(1.09)}',
      '.ddy-btn:active:not(:disabled){transform:translateY(.5px)}',
      '.ddy-btn:disabled{opacity:.42;cursor:default;filter:none}',
      '.ddy-btn.ghost{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.ddy-btn.ghost:hover:not(:disabled){background:rgba(127,127,127,.1);filter:none}',
      '.ddy-spacer{flex:1}',
      '.ddy-dirty{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#c07a00}',
      '.ddy-dirty::before{content:"";width:6px;height:6px;border-radius:50%;background:#e08c00}',

      // ---------- 消息 ----------
      '.ddy-msg{display:flex;gap:9px;padding:10px 13px;border-radius:10px;font-size:12px;line-height:18px;white-space:pre-line;border-left:3px solid;word-break:break-word}',
      '.ddy-msg.err{border-color:var(--dsw-alias-state-error-primary);background:rgba(220,80,80,.09);color:var(--dsw-alias-state-error-primary)}',
      '.ddy-msg.ok{border-color:#3fa34d;background:rgba(63,163,77,.1);color:#2f8f3d}',
      '.ddy-msg em{font-style:normal;font-weight:700;flex:none}',

      // ---------- 文件表 ----------
      '.ddy-files{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}',
      '.ddy-files>header{display:flex;align-items:center;gap:8px;padding:9px 13px;background:rgba(127,127,127,.05);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;font-weight:600}',
      '.ddy-files>header .ddy-tagline{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.ddy-frow{display:grid;grid-template-columns:minmax(0,1fr) auto 66px 46px;align-items:center;gap:10px;padding:7px 13px;font-size:12px;border-bottom:1px solid rgba(127,127,127,.09);transition:background .12s}',
      '.ddy-frow:last-child{border-bottom:none}',
      '.ddy-frow:hover{background:rgba(127,127,127,.06)}',
      '.ddy-fname{display:flex;align-items:center;gap:7px;min-width:0}',
      '.ddy-fname span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ddy-tag{flex:none;font-size:10.5px;line-height:15px;padding:1px 6px;border-radius:5px;border:1px solid transparent;white-space:nowrap}',
      '.ddy-tag.pub{color:#2f8f3d;background:rgba(63,163,77,.11);border-color:rgba(63,163,77,.28)}',
      '.ddy-tag.prv{color:#a86800;background:rgba(200,140,0,.11);border-color:rgba(200,140,0,.28)}',
      '.ddy-dim{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:right}',
      '.ddy-read{padding:0;border:none;background:none;color:var(--dsw-alias-brand-primary);font-family:inherit;font-size:11.5px;cursor:pointer;text-align:right}',
      '.ddy-read:hover{text-decoration:underline}',

      // ---------- 输出区 ----------
      '.ddy-out{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}',
      '.ddy-out>header{display:flex;align-items:center;gap:8px;padding:9px 13px;background:rgba(127,127,127,.05);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;font-weight:600}',
      '.ddy-out>header .ddy-close{margin-left:auto;padding:0 4px;border:none;background:none;color:var(--dsw-alias-label-tertiary);font-size:15px;line-height:1;cursor:pointer}',
      '.ddy-out>header .ddy-close:hover{color:var(--dsw-alias-label-primary)}',
      '.ddy-pre{margin:0;padding:11px 13px;max-height:340px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:17px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}',

      // ---------- 骨架 ----------
      '.ddy-skel{height:40px;border-radius:10px;background:linear-gradient(90deg,rgba(127,127,127,.07),rgba(127,127,127,.15),rgba(127,127,127,.07));background-size:200% 100%;animation:ddy-sh 1.4s ease-in-out infinite}',
      '@keyframes ddy-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}',

      // ---------- 响应式 ----------
      '@media (max-width:620px){.ddy-stat{grid-template-columns:1fr}.ddy-in{width:100%}.ddy-row{flex-wrap:wrap}.ddy-frow{grid-template-columns:minmax(0,1fr) auto 44px}}',
    ].join('')

    /** 把样式塞进 document.head —— 上一版漏了这一步，类名全成了死的 */
    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById(CSS_TAG)) return
      const el = document.createElement('style')
      el.id = CSS_TAG
      el.textContent = CSS
      document.head.appendChild(el)
    }

    const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    const setPath = (obj, p, v) => {
      const keys = p.split('.')
      const clone = Array.isArray(obj) ? [...obj] : { ...obj }
      let cur = clone
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] || {}) }
        cur = cur[k]
      }
      cur[keys[keys.length - 1]] = v
      return clone
    }

    // ---------------- 字段表（唯一真相） ----------------
    const FIELDS = [
      {
        group: '什么时候写',
        tag: '节奏',
        items: [
          { k: 'enabled', t: 'switch', label: '启用', hint: '关掉后到点也不会动' },
          {
            k: 'times',
            t: 'list',
            label: '时间点',
            hint: '24 小时制 HH:MM，逗号分隔。可以写多个：12:30, 22:00',
          },
          { k: 'weekdays', t: 'weekdays', label: '哪几天写', wide: true },
          {
            k: 'catchUpHours',
            t: 'number',
            label: '补写窗口（小时）',
            hint: '错过时间点后多少小时内还补写。0 = 只在那一分钟写',
          },
        ],
      },
      {
        group: '谁来写',
        tag: '执行',
        items: [
          {
            k: 'sessionId',
            t: 'text',
            label: '目标会话',
            hint: '留空 = 自动用专用会话 dsh-diary（推荐）。填了就写进那个会话',
            wide: true,
            mono: true,
          },
          { k: 'cwd', t: 'text', label: '会话工作目录', hint: '留空 = ~/.dsh/diary-work', wide: true, mono: true },
          { k: 'model', t: 'text', label: '模型覆盖', hint: '留空用会话默认模型' },
        ],
      },
      {
        group: '写到哪',
        tag: '产出',
        items: [
          { k: 'outDir', t: 'text', label: '输出目录', hint: '留空 = ~/.dsh/diary', wide: true, mono: true },
          {
            k: 'publicPattern',
            t: 'text',
            label: '公开篇文件名',
            hint: '占位符：{date} {yyyy} {mm} {dd} {weekday}',
            wide: true,
            mono: true,
          },
          { k: 'privatePattern', t: 'text', label: '私密篇文件名', wide: true, mono: true },
          { k: 'monthlyDir', t: 'switch', label: '按月分子目录', hint: '放成 2026-11/ 这样' },
          { k: 'appendHeader', t: 'switch', label: '文件头加元信息' },
        ],
      },
      {
        group: '写成什么样',
        tag: '内容',
        items: [
          { k: 'publicWords', t: 'number', label: '公开篇字数' },
          { k: 'privateWords', t: 'number', label: '私密篇字数' },
          { k: 'style', t: 'textarea', label: '文风指令', hint: '留空用内置默认文风', wide: true },
          { k: 'persona', t: 'textarea', label: '人设补充', hint: '留空用内置默认人设', wide: true },
          { k: 'redact', t: 'list', label: '公开篇禁词', hint: '逗号分隔。公开篇里出现这些词要换说法', wide: true },
          { k: 'publicHidePaths', t: 'switch', label: '公开篇隐藏路径', hint: '不出现盘符、用户名、端口' },
        ],
      },
      {
        group: '采哪些数据',
        tag: '来源',
        items: [
          { k: 'sources.sessions', t: 'switch', label: '会话标题 / 目录' },
          { k: 'sources.turnOutline', t: 'switch', label: '每轮问答摘要', hint: '信息量最大的一项' },
          { k: 'sources.stats', t: 'switch', label: '轮次 / 耗时 / token' },
          { k: 'sources.todos', t: 'switch', label: '未完成的 todo' },
          { k: 'sources.subagents', t: 'switch', label: '子代理记录' },
          { k: 'sources.whaleLog', t: 'switch', label: '鲸鱼（B站）活动' },
          { k: 'sources.plugins', t: 'switch', label: '其他插件的痕迹' },
          { k: 'sources.logs', t: 'switch', label: '运行日志', hint: '体积大，默认关' },
          { k: 'maxSessions', t: 'number', label: '最多取几个会话' },
          { k: 'maxTurnsPerSession', t: 'number', label: '每会话最多几轮' },
          { k: 'maxDataChars', t: 'number', label: '数据摘要字数上限', hint: '超了硬截断，防止 prompt 撑爆上下文' },
        ],
      },
      {
        group: '高级',
        tag: '手动挡',
        items: [
          {
            k: 'promptTemplate',
            t: 'textarea',
            label: '自定义指令模板',
            hint: '留空用内置模板。占位符：{date} {time} {data} {publicPath} {privatePath} {publicWords} {privateWords} {style} {persona} {redactLine} {hidePathsLine}',
            wide: true,
            mono: true,
            rows: 7,
          },
          { k: 'keepDays', t: 'number', label: '保留天数', hint: '0 = 永久保留' },
          { k: 'autoCleanup', t: 'switch', label: '跑完自动清理过期' },
        ],
      },
    ]

    /** 算下一次什么时候跑（纯前端推算，只用于显示） */
    function nextRunText(cfg) {
      if (!cfg) return '—'
      if (!cfg.enabled) return '已关闭'
      const times = (cfg.times || []).filter(Boolean).slice().sort()
      if (!times.length) return '未设置'
      const wd = Array.isArray(cfg.weekdays) ? cfg.weekdays : []
      if (!wd.length) return '没有启用日'
      const toMin = (s) => {
        const [a, b] = String(s).split(':').map(Number)
        return a * 60 + b
      }
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      for (let d = 0; d < 8; d++) {
        const date = new Date(now)
        date.setDate(date.getDate() + d)
        if (!wd.includes(date.getDay())) continue
        for (const t of times) {
          if (d === 0 && toMin(t) <= nowMin) continue
          return d === 0 ? `今天 ${t}` : d === 1 ? `明天 ${t}` : `周${WEEK[date.getDay()]} ${t}`
        }
      }
      return '—'
    }

    function Switch({ checked, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': !!checked,
        className: 'ddy-sw' + (checked ? ' on' : ''),
        onClick: () => onChange(!checked),
      })
    }

    function Field({ item, cfg, onChange }) {
      const raw = getPath(cfg, item.k)
      const [text, setText] = useState(() => (Array.isArray(raw) ? raw.join(', ') : raw ?? ''))
      const sig = Array.isArray(raw) ? raw.join(',') : raw ?? ''
      useEffect(() => {
        setText(Array.isArray(raw) ? raw.join(', ') : raw ?? '')
      }, [sig])

      if (item.t === 'switch') {
        return h(Switch, { checked: !!raw, onChange: (v) => onChange(item.k, v) })
      }
      if (item.t === 'weekdays') {
        const arr = Array.isArray(raw) ? raw : []
        return h(
          'div',
          { className: 'ddy-wd' },
          WEEK.map((w, i) =>
            h(
              'button',
              {
                key: i,
                type: 'button',
                className: arr.includes(i) ? 'on' : '',
                onClick: () => {
                  const next = arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i].sort()
                  onChange(item.k, next)
                },
              },
              w,
            ),
          ),
        )
      }
      if (item.t === 'number') {
        return h('input', {
          className: 'ddy-in num',
          type: 'number',
          value: text,
          onChange: (e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(item.k, n)
          },
        })
      }
      if (item.t === 'textarea') {
        return h('textarea', {
          className: 'ddy-ta' + (item.mono ? ' mono' : ''),
          value: text,
          rows: item.rows || 3,
          spellCheck: false,
          onChange: (e) => {
            setText(e.target.value)
            onChange(item.k, e.target.value)
          },
        })
      }
      if (item.t === 'list') {
        return h('input', {
          className: 'ddy-in' + (item.mono ? ' mono' : ''),
          style: item.wide ? { width: '100%' } : undefined,
          value: text,
          onChange: (e) => {
            setText(e.target.value)
            const arr = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
            onChange(item.k, arr)
          },
        })
      }
      return h('input', {
        className: 'ddy-in' + (item.mono ? ' mono' : ''),
        style: item.wide ? { width: '100%' } : undefined,
        value: text,
        spellCheck: false,
        onChange: (e) => {
          setText(e.target.value)
          onChange(item.k, e.target.value)
        },
      })
    }

    function DiarySection() {
      const [cfg, setCfg] = useState(null)
      const [status, setStatus] = useState(null)
      const [files, setFiles] = useState([])
      const [busy, setBusy] = useState('')
      const [err, setErr] = useState('')
      const [okMsg, setOkMsg] = useState('')
      const [out, setOut] = useState('')
      const [outTitle, setOutTitle] = useState('')
      const [savedJson, setSavedJson] = useState('')
      const [problems, setProblems] = useState([])

      useEffect(() => {
        ensureCss()
      }, [])

      const fetchJson = useCallback(async (url, init) => {
        const r = await fetch(url, init)
        let j = null
        try {
          j = await r.json()
        } catch {
          throw new Error(`HTTP ${r.status} 返回的不是 JSON`)
        }
        if (!r.ok && j && j.error) throw new Error(j.error)
        return j
      }, [])

      const load = useCallback(async () => {
        setErr('')
        try {
          const [c, s] = await Promise.all([fetchJson(`${API}/config`), fetchJson(`${API}/status`)])
          setCfg(c.config)
          setSavedJson(JSON.stringify(c.config))
          setProblems(c.problems || [])
          setStatus(s)
        } catch (e) {
          setErr(`读取失败：${e.message}`)
        }
      }, [fetchJson])

      useEffect(() => {
        load()
      }, [load])

      const onChange = useCallback((k, v) => {
        setCfg((prev) => (prev ? setPath(prev, k, v) : prev))
      }, [])

      const save = useCallback(async () => {
        if (!cfg) return
        setBusy('save')
        setErr('')
        setOkMsg('')
        try {
          const r = await fetchJson(`${API}/config`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(cfg),
          })
          setCfg(r.config)
          setSavedJson(JSON.stringify(r.config))
          setProblems(r.problems || [])
          if (r.problems && r.problems.length) setErr(`配置存下了，但有问题：\n${r.problems.join('\n')}`)
          else setOkMsg('已保存，下一跳生效（不用重启 DSH）')
        } catch (e) {
          setErr(`保存失败：${e.message}`)
        } finally {
          setBusy('')
        }
      }, [cfg, fetchJson])

      const preview = useCallback(async () => {
        setBusy('preview')
        setErr('')
        setOkMsg('')
        try {
          const r = await fetchJson(`${API}/preview`)
          setOutTitle(`今天的数据 · ${r.date} · ${r.sessionCount} 个会话 · ${r.chars} 字`)
          setOut(
            `公开篇 → ${r.paths.publicPath}\n私密篇 → ${r.paths.privatePath}\n\n` +
              `${r.markdown}\n\n──────── 投给 agent 的完整指令 ────────\n${r.promptAll}`,
          )
        } catch (e) {
          setErr(`预览失败：${e.message}`)
        } finally {
          setBusy('')
        }
      }, [fetchJson])

      const run = useCallback(async () => {
        setBusy('run')
        setErr('')
        setOkMsg('')
        try {
          const r = await fetchJson(`${API}/run`, { method: 'POST' })
          setOkMsg(
            `已投递到会话 ${r.sessionId}（${r.chars} 字）。去看那个会话，它正在写。\n落点：${r.paths.publicPath}\n      ${r.paths.privatePath}`,
          )
          load()
        } catch (e) {
          setErr(`生成失败：${e.message}`)
        } finally {
          setBusy('')
        }
      }, [fetchJson, load])

      const list = useCallback(async () => {
        setBusy('list')
        setErr('')
        setOkMsg('')
        try {
          const r = await fetchJson(`${API}/list`)
          setFiles(r.files || [])
          if (!r.files || !r.files.length) setOkMsg(`目录里还没有日记：${r.dir}`)
        } catch (e) {
          setErr(`列目录失败：${e.message}`)
        } finally {
          setBusy('')
        }
      }, [fetchJson])

      const readFile = useCallback(
        async (name) => {
          try {
            const r = await fetchJson(`${API}/read?name=${encodeURIComponent(name)}`)
            setOutTitle(name)
            setOut(r.text)
          } catch (e) {
            setErr(`读取失败：${e.message}`)
          }
        },
        [fetchJson],
      )

      const openFolder = useCallback(async () => {
        try {
          const r = await fetchJson(`${API}/open-folder`, { method: 'POST' })
          setOkMsg(`已打开：${r.dir}`)
        } catch (e) {
          setErr(`打开失败：${e.message}`)
        }
      }, [fetchJson])

      const dirty = cfg && savedJson && JSON.stringify(cfg) !== savedJson
      const next = useMemo(() => nextRunText(cfg), [cfg])
      const ranToday = (status && status.ranToday) || []

      return h(
        'div',
        { className: 'ddy' },

        // ---- 头部 ----
        h(
          'div',
          { className: 'ddy-head' },
          h(
            'div',
            { className: 'ddy-head-main' },
            h('h3', { className: 'ddy-h1' }, '日记'),
            h(
              'p',
              { className: 'ddy-sub' },
              '每天到点让 agent 给自己写两篇：一篇公开、一篇私密。插件只管闹钟和采数据，写字的是 agent 本身。',
            ),
          ),
          status
            ? h(
                'span',
                { className: 'ddy-pill ' + (status.enabled ? 'on' : 'off'), title: status.busy ? '正在跑' : '' },
                h('i', { className: 'ddy-dot' }),
                status.enabled ? (status.busy ? '正在跑' : '已启用') : '已关闭',
              )
            : null,
        ),

        // ---- 状态三格 ----
        status
          ? h(
              'div',
              { className: 'ddy-stat' },
              h(
                'div',
                null,
                h('div', { className: 'ddy-k' }, '下次'),
                h('div', { className: 'ddy-v' }, next),
              ),
              h(
                'div',
                null,
                h('div', { className: 'ddy-k' }, '今天'),
                h('div', { className: 'ddy-v' }, ranToday.length ? `已写 ${ranToday.length} 次` : '还没写'),
              ),
              h(
                'div',
                null,
                h('div', { className: 'ddy-k' }, '上次'),
                h(
                  'div',
                  { className: 'ddy-v', title: status.lastTick && status.lastTick.reason },
                  status.lastRun
                    ? `${status.lastRun.date} ${status.lastRun.slot}`
                    : (status.lastTick && status.lastTick.reason) || '从未跑过',
                ),
              ),
            )
          : null,

        // ---- 配置卡片 ----
        cfg
          ? FIELDS.map((g) =>
              h(
                'section',
                { className: 'ddy-card', key: g.group },
                h(
                  'header',
                  null,
                  h('h4', null, g.group),
                  g.tag ? h('span', { className: 'ddy-tagline' }, g.tag) : null,
                ),
                h(
                  'div',
                  { className: 'ddy-body' },
                  g.items.map((item) =>
                    h(
                      'div',
                      { className: 'ddy-row' + (item.wide ? ' wide' : ''), key: item.k },
                      h(
                        'div',
                        { className: 'ddy-meta' },
                        h('div', { className: 'ddy-label' }, item.label),
                        item.hint ? h('div', { className: 'ddy-hint' }, item.hint) : null,
                      ),
                      h('div', { className: 'ddy-ctl' }, h(Field, { item, cfg, onChange })),
                    ),
                  ),
                ),
              ),
            )
          : h('div', { className: 'ddy-skel' }),

        // ---- 操作条 ----
        h(
          'div',
          { className: 'ddy-actions' },
          h(
            'button',
            { className: 'ddy-btn', onClick: save, disabled: !!busy },
            busy === 'save' ? '保存中…' : '保存',
          ),
          dirty ? h('span', { className: 'ddy-dirty' }, '有改动未保存') : null,
          h('span', { className: 'ddy-spacer' }),
          h(
            'button',
            { className: 'ddy-btn ghost', onClick: run, disabled: !!busy },
            busy === 'run' ? '投递中…' : '立即生成一次',
          ),
          h(
            'button',
            { className: 'ddy-btn ghost', onClick: preview, disabled: !!busy },
            busy === 'preview' ? '采集中…' : '预览今天的数据',
          ),
          h('button', { className: 'ddy-btn ghost', onClick: list, disabled: !!busy }, '看已有日记'),
          h('button', { className: 'ddy-btn ghost', onClick: openFolder, disabled: !!busy }, '打开目录'),
          h('button', { className: 'ddy-btn ghost', onClick: load, disabled: !!busy }, '重新读取'),
        ),

        // ---- 消息 ----
        err ? h('div', { className: 'ddy-msg err' }, h('em', null, '✕'), h('span', null, err)) : null,
        okMsg ? h('div', { className: 'ddy-msg ok' }, h('em', null, '✓'), h('span', null, okMsg)) : null,
        problems.length
          ? h('div', { className: 'ddy-msg err' }, h('em', null, '!'), h('span', null, problems.join('\n')))
          : null,

        // ---- 文件表 ----
        files.length
          ? h(
              'div',
              { className: 'ddy-files' },
              h('header', null, '已有日记', h('span', { className: 'ddy-tagline' }, `共 ${files.length} 篇`)),
              files.slice(0, 40).map((f) =>
                h(
                  'div',
                  { className: 'ddy-frow', key: f.path },
                  h(
                    'div',
                    { className: 'ddy-fname', title: f.path },
                    h('span', null, f.name),
                    f.kind === 'private'
                      ? h('i', { className: 'ddy-tag prv' }, '私密')
                      : f.kind === 'public'
                        ? h('i', { className: 'ddy-tag pub' }, '公开')
                        : null,
                  ),
                  h('div', { className: 'ddy-dim' }, `${Math.max(1, Math.round(f.size / 1024))} KB`),
                  h(
                    'div',
                    { className: 'ddy-dim' },
                    new Date(f.mtime).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
                  ),
                  h('button', { className: 'ddy-read', onClick: () => readFile(f.name) }, '打开'),
                ),
              ),
            )
          : null,

        // ---- 输出区 ----
        out
          ? h(
              'div',
              { className: 'ddy-out' },
              h(
                'header',
                null,
                h('span', null, outTitle || '输出'),
                h('button', { className: 'ddy-close', onClick: () => setOut(''), title: '收起' }, '×'),
              ),
              h('pre', { className: 'ddy-pre' }, out),
            )
          : null,
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ensureCss()
      ctx.effect(
        () =>
          ctx.slots.inject(
            'settings.section',
            () =>
              ctx.slots.register(
                { name: 'settings.section', id: NS, order: 7, label: () => '日记' },
                DiarySection,
              ),
            'dsh-diary: settings section',
          ),
        'dsh-diary: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.DiarySection = DiarySection
    exports.FIELDS = FIELDS
    return module.exports
  },
})

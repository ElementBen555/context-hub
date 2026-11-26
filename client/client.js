// dsh-context-hub 客户端：composer 下方一枚状态胶囊 + 展开的只读面板。
// 数据全部来自宿主路由 /api/context-hub.status（connection 服务托管鉴权）。
window.__ModuleLoader__.load({
  id: 'dsh-context-hub',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const PATH = '/api/context-hub.status'
    const WATERMARK_PATH = '/api/context-hub.watermark'
    const REVIEW_PATH = '/api/context-hub.review'
    const ACTION_PATH = '/api/context-hub.action'

    const ACTIVITY_LABELS = {
      recall: '召回',
      'recall-miss': '召回未命中',
      extract: '抽取',
      compact: '压缩',
      summary: '摘要',
      request: '请求',
      probe: '探针',
      'compact-hub': 'hub 压缩',
      'compact-hub-fallback': 'hub 压缩回退',
      restore: '还原原文',
      abtest: '压缩 A/B',
      'review-approve': '审核批准',
      'review-reject': '审核拒绝',
      'embedding-start': '启动向量服务',
      'embedding-ready': '向量服务就绪',
      'embedding-start-error': '向量服务启动失败',
      'embedding-reset': '清旧向量',
      reembed: '重算向量',
      rewrite: '改写',
      'rewrite-error': '改写失败',
      'rewrite-empty': '改写空输出',
      'rewrite-retry': '改写重试',
      rerank: '重排',
      'rerank-error': '重排失败',
      'rerank-empty': '重排空输出',
      watermark: '水位压缩',
      'watermark-error': '水位失败',
      'watermark-toggle': '水位开关',
    }

    const SEGMENTS = [
      { key: 'user', label: '用户', color: 'var(--dsw-alias-state-business-primary, #3b82f6)' },
      { key: 'assistant', label: '助手', color: '#8b5cf6' },
      { key: 'tool', label: '工具', color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' },
      { key: 'injected', label: '注入', color: 'var(--dsw-alias-state-success-primary, #10b981)' },
      { key: 'summary', label: '摘要', color: '#06b6d4' },
      { key: 'other', label: '其他', color: 'var(--dsw-alias-label-dimmed, #94a3b8)' },
    ]

    const KIND_COLORS = {
      decision: '#6366f1',
      fact: '#0ea5e9',
      preference: '#f59e0b',
      task: '#10b981',
      skill: '#a855f7',
      summary: '#64748b',
    }
    const KIND_LABELS = { decision: '决策', fact: '事实', preference: '偏好', task: '任务', skill: '技能', summary: '摘要' }
    const SCOPES = [
      { key: 'session', label: '会话', color: '#3b82f6' },
      { key: 'project', label: '项目', color: '#8b5cf6' },
      { key: 'global', label: '全局', color: '#10b981' },
    ]

    const CSS = `      #chp-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;
        background:color-mix(in srgb,var(--dsw-alias-bg-mask-1,#0b1220) 44%,transparent);backdrop-filter:blur(3px);
        animation:chp-fade .14s ease-out}
      @keyframes chp-fade{from{opacity:0}to{opacity:1}}
      @keyframes chp-rise{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
      .chp-card{width:min(640px,100%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;
        background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f172a);
        border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.12));border-radius:18px;
        box-shadow:0 28px 80px rgba(2,6,23,.36),0 2px 6px rgba(2,6,23,.08);
        font:13px/1.55 inherit;animation:chp-rise .16s ease-out}
      .chp-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;
        background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2,rgba(248,250,252,.9)),transparent)}
      .chp-logo{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;
        font-size:11px;font-weight:700;letter-spacing:.02em;color:#fff;
        background:linear-gradient(135deg,var(--dsw-alias-brand-primary,#2563eb),#8b5cf6);
        box-shadow:0 4px 12px color-mix(in srgb,#2563eb 35%,transparent)}
      .chp-titles{flex:1;min-width:0}
      .chp-title{margin:0;font-size:15px;font-weight:650;letter-spacing:.01em}
      .chp-sub{margin-top:1px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#94a3b8);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .chp-actions{display:flex;gap:6px;flex:none}
      .chp-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;cursor:pointer;
        border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.12));background:transparent;
        color:var(--dsw-alias-label-secondary,#475569);font:inherit;transition:background .12s,color .12s}
      .chp-icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.06));color:var(--dsw-alias-label-primary,#0f172a)}
      .chp-kpi{padding:12px 18px 0}
      .chp-hero{display:flex;align-items:center;gap:16px;padding:12px 14px;border-radius:14px;
        background:var(--dsw-alias-card-fill,var(--dsw-alias-bg-layer-2,#f8fafc));
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-ring{flex:none;display:grid;place-items:center;position:relative;width:78px;height:78px}
      .chp-ring svg{transform:rotate(-90deg)}
      .chp-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
      .chp-ring-num{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
      .chp-ring-cap{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-stats{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px;min-width:0}
      .chp-stat{min-width:0}
      .chp-stat-k{font-size:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap}
      .chp-stat-v{font-size:13.5px;font-weight:650;font-variant-numeric:tabular-nums;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .chp-tabs{display:flex;gap:2px;padding:10px 14px 0;margin-top:10px;
        border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-tab{position:relative;display:inline-flex;align-items:center;gap:6px;padding:8px 10px 9px;
        border:0;background:none;cursor:pointer;border-radius:8px 8px 0 0;font:inherit;font-size:12px;
        font-weight:600;color:var(--dsw-alias-label-tertiary,#94a3b8);transition:color .12s,background .12s}
      .chp-tab:hover{color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.05))}
      .chp-tab-on{color:var(--dsw-alias-label-primary,#0f172a)}
      .chp-tab-on::after{content:'';position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;
        background:var(--dsw-alias-state-business-primary,#2563eb)}
      .chp-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2563eb);outline-offset:-2px}
      .chp-tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 5px;
        border-radius:999px;font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:0;
        background:var(--dsw-alias-bg-layer-3,rgba(15,23,42,.07));color:var(--dsw-alias-label-secondary,#475569)}
      .chp-tab-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f59e0b);
        box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 20%,transparent)}
      .chp-callout{display:flex;align-items:center;gap:8px;width:100%;padding:8px 11px;border-radius:11px;
        border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 30%,transparent);
        background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 9%,transparent);
        color:var(--dsw-alias-label-primary,#0f172a);font:inherit;font-size:12px;cursor:pointer;text-align:left;
        transition:background .12s}
      .chp-callout:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 15%,transparent)}
      .chp-callout-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f59e0b);flex:none}
      .chp-callout-text{flex:1;font-weight:600}
      .chp-callout-go{color:var(--dsw-alias-label-secondary,#475569);font-size:11.5px}
      .chp-tab-badge-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 20%,transparent);
        color:var(--dsw-alias-state-warn-primary,#b45309)}
      .chp-scroll{flex:1;overflow:auto;padding:13px 18px 18px;display:flex;flex-direction:column;gap:13px}
      .chp-scroll::-webkit-scrollbar{width:8px}
      .chp-scroll::-webkit-scrollbar-thumb{border-radius:8px;background:var(--dsw-alias-scrollbar-hover-l2,rgba(15,23,42,.18));border:2px solid transparent;background-clip:padding-box}
      .chp-sec-title{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px;
        font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
        color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-sec-extra{font-size:11px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-bar{display:flex;height:9px;border-radius:999px;overflow:hidden;
        background:var(--dsw-alias-border-l1,rgba(15,23,42,.08));box-shadow:inset 0 0 0 1px rgba(15,23,42,.04)}
      .chp-seg{height:100%;min-width:0;transition:width .25s ease}
      .chp-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(94px,1fr));gap:8px}
      .chp-tile{padding:7px 10px 8px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,rgba(248,250,252,.7));
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.07));min-width:0}
      .chp-tile-k{font-size:9.5px;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .chp-tile-v{font-size:17px;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums;margin-top:1px}
      .chp-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
      .chp-mini-title{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
        color:var(--dsw-alias-label-tertiary,#94a3b8);margin-bottom:6px}
      .chp-vbars{display:flex;flex-direction:column;gap:5px}
      .chp-vbar-row{display:grid;grid-template-columns:46px 1fr 34px;align-items:center;gap:8px;font-size:11px}
      .chp-vbar-k{color:var(--dsw-alias-label-secondary,#475569);white-space:nowrap}
      .chp-vbar-v{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#0f172a);font-weight:600}
      .chp-track{display:block;height:6px;border-radius:999px;overflow:hidden;
        background:var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-track > span{display:block;height:100%;border-radius:999px;transition:width .25s ease}
      .chp-table{width:100%;border-collapse:collapse;font-size:12px}
      .chp-table th{padding:4px 6px 6px;text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.07em;
        text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap;
        border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-table td{padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.06));
        color:var(--dsw-alias-label-primary,#0f172a);vertical-align:middle}
      .chp-table tbody tr:last-child td{border-bottom:0}
      .chp-table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover,rgba(148,163,184,.1))}
      .chp-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .chp-celltext{max-width:244px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .chp-note{margin-top:5px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-dot{width:8px;height:8px;border-radius:3px;flex:none;display:inline-block}
      .chp-disclosure{display:inline-flex;align-items:center;gap:7px;background:none;border:0;padding:3px 6px;margin:-3px -6px;
        color:var(--dsw-alias-label-secondary,#475569);font:inherit;font-size:11px;font-weight:600;
        letter-spacing:.04em;cursor:pointer;border-radius:6px;transition:color .12s}
      .chp-disclosure:hover{color:var(--dsw-alias-label-primary,#0f172a);background:var(--dsw-alias-interactive-bg-hover,rgba(148,163,184,.14))}
      .chp-disclosure:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2563eb);outline-offset:2px}
      .chp-tri{display:inline-block;width:0;height:0;border-left:5px solid currentColor;
        border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .14s ease}
      .chp-badge{display:inline-flex;align-items:center;padding:1px 6px;border-radius:6px;font-size:10px;
        font-weight:600;letter-spacing:.02em}
      .chp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px}
      .chp-empty{padding:10px 12px;border-radius:11px;border:1px dashed var(--dsw-alias-border-l2,rgba(15,23,42,.14));
        font-size:11.5px;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-alert{margin:0;padding:9px 11px;border-radius:11px;font-size:12px;
        color:var(--dsw-alias-state-error-primary,#dc2626);
        background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 9%,transparent);
        border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 24%,transparent)}
      .chp-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:10px;
        padding:9px 11px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,rgba(248,250,252,.7));
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.07))}
      .chp-switch{flex:none;width:38px;height:22px;border-radius:999px;cursor:pointer;position:relative;
        border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.16));
        background:var(--dsw-alias-border-l2,rgba(15,23,42,.16));transition:background .15s,border-color .15s}
      .chp-switch-on{background:var(--dsw-alias-state-business-primary,#2563eb);border-color:transparent}
      .chp-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;
        box-shadow:0 1px 3px rgba(2,6,23,.28);transition:left .15s}
      .chp-switch-on .chp-knob{left:18px}
      .chp-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 18px;
        border-top:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08));
        font-size:10.5px;color:var(--dsw-alias-label-tertiary,#94a3b8);
        background:var(--dsw-alias-bg-layer-2,rgba(248,250,252,.6))}
      .chp-pill{display:inline-flex;align-items:center;gap:7px;margin:2px 8px 6px 0;padding:3px 10px 3px 5px;
        border-radius:999px;cursor:pointer;font-family:inherit;font-size:12px;line-height:16px;
        color:var(--dsw-alias-label-secondary,#475569);
        background:var(--dsw-alias-bg-layer-1,#fff);
        border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));
        box-shadow:0 1px 2px rgba(2,6,23,.05);transition:color .12s,border-color .12s,background .12s}
      .chp-pill:hover{color:var(--dsw-alias-label-primary,#0f172a);
        border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#2563eb) 45%,transparent);
        background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.04))}
      .chp-pill-strong{color:var(--dsw-alias-label-primary,#0f172a);font-weight:600}
      .chp-pill-dim{color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-pill-warn{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f59e0b);
        box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 22%,transparent)}
      .chp-mini-btn{display:inline-flex;align-items:center;gap:3px;background:none;border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));
        border-radius:7px;color:var(--dsw-alias-label-secondary,#475569);font:inherit;font-size:10.5px;
        padding:2px 7px;cursor:pointer;line-height:1.5;transition:background .12s,color .12s,border-color .12s}
      .chp-mini-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.05));color:var(--dsw-alias-label-primary,#0f172a)}
      .chp-mini-btn.ok{color:var(--dsw-alias-state-success-primary,#047857);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#10b981) 34%,transparent)}
      .chp-mini-btn.danger{color:var(--dsw-alias-state-error-primary,#b91c1c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 32%,transparent)}
      .chp-rowactions{display:flex;gap:4px;justify-content:flex-end}
      .chp-review{display:flex;flex-direction:column;gap:8px}
      .chp-review-row{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;
        padding:9px 10px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,rgba(248,250,252,.7));
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-review-main{min-width:0}
      .chp-review-meta{color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-review-text{font-size:12px;word-break:break-word;margin-top:2px}
      .chp-review-actions{display:flex;gap:5px;flex:none}
      .chp-spark{display:block;width:100%;height:44px}
      .chp-spark-empty{display:grid;place-items:center;height:44px;border-radius:9px;border:1px dashed var(--dsw-alias-border-l2,rgba(15,23,42,.14));
        font-size:11px;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-kv{font-variant-numeric:tabular-nums}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      let el = document.getElementById('chp-style')
      if (el === null) {
        el = document.createElement('style')
        el.id = 'chp-style'
        document.head.appendChild(el)
      }
      if (el.textContent !== CSS) el.textContent = CSS
    }

    const fmt = (n) => (typeof n === 'number' && Number.isFinite(n)
      ? (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n))
      : '—')
    const pctText = (value, total) => {
      if (!(total > 0)) return '0%'
      const pct = (value / total) * 100
      return pct > 0 && pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
    }

    function ring(percent, size, width, color) {
      const radius = (size - width) / 2
      const circumference = 2 * Math.PI * radius
      const value = Math.max(0, Math.min(100, percent || 0))
      return h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
        h('circle', {
          cx: size / 2, cy: size / 2, r: radius, fill: 'none',
          stroke: 'var(--dsw-alias-border-l2, rgba(15,23,42,.12))', strokeWidth: width,
        }),
        h('circle', {
          cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: color, strokeWidth: width,
          strokeLinecap: 'round', strokeDasharray: `${(value / 100) * circumference} ${circumference}`,
        }))
    }

    function Stat(props) {
      return h('div', { className: 'chp-stat' },
        h('div', { className: 'chp-stat-k' }, props.label),
        h('div', { className: 'chp-stat-v', title: props.title ?? undefined }, props.value))
    }

    function Section(props) {
      return h('section', null,
        h('h3', { className: 'chp-sec-title' }, props.title, props.extra ? h('span', { className: 'chp-sec-extra' }, props.extra) : null),
        props.children)
    }

    function Badge(props) {
      const color = KIND_COLORS[props.kind] ?? '#64748b'
      return h('span', {
        className: 'chp-badge',
        style: {
          color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 26%, transparent)`,
        },
      }, props.children ?? props.kind)
    }

    function Track(props) {
      const percent = Math.max(0, Math.min(100, Number.isFinite(props.percent) ? props.percent : 0))
      return h('span', { className: 'chp-track', title: props.title ?? undefined, 'aria-hidden': 'true' },
        h('span', { style: { width: `${percent}%`, background: props.color ?? 'var(--dsw-alias-state-business-primary,#2563eb)' } }))
    }

    function Sparkline(props) {
      const values = Array.isArray(props.values) ? props.values.map(value => Number(value) || 0) : []
      if (values.length === 0) return h('div', { className: 'chp-spark-empty' }, '暂无样本')
      const max = Math.max(1, ...values)
      const points = values.map((value, index) => {
        const x = values.length === 1 ? 50 : 2 + (index / (values.length - 1)) * 96
        const y = 34 - (value / max) * 28
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      const last = points[points.length - 1].split(',')
      const color = props.color ?? 'var(--dsw-alias-state-business-primary,#2563eb)'
      return h('svg', {
        className: 'chp-spark',
        viewBox: '0 0 100 38',
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
      },
        h('line', {
          x1: 0, y1: 34, x2: 100, y2: 34,
          stroke: 'var(--dsw-alias-border-l2,rgba(15,23,42,.12))', strokeWidth: 1, vectorEffect: 'non-scaling-stroke',
        }),
        h('polygon', { points: `2,34 ${points.join(' ')} 98,34`, fill: color, opacity: 0.12 }),
        h('polyline', {
          points: points.join(' '), fill: 'none', stroke: color, strokeWidth: 1.6,
          strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke',
        }),
        h('circle', { cx: Number(last[0]), cy: Number(last[1]), r: 1.9, fill: color }))
    }

    function Tile(props) {
      return h('div', { className: 'chp-tile', title: props.title ?? undefined },
        h('div', { className: 'chp-tile-k' }, props.label),
        h('div', { className: 'chp-tile-v' }, props.value))
    }

    function Bars(props) {
      const max = Math.max(1, ...props.items.map(item => item.value))
      return h('div', { className: 'chp-vbars' }, props.items.map(item => h('div', { key: item.key, className: 'chp-vbar-row' },
        h('span', { className: 'chp-vbar-k' }, item.label),
        h(Track, { percent: (item.value / max) * 100, color: item.color, title: `${item.label} ${item.value}` }),
        h('span', { className: 'chp-vbar-v' }, String(item.value)))))
    }

    function Composition(props) {
      const parts = props.parts
      if (parts === null || parts === undefined) return null
      const items = SEGMENTS.map(segment => ({ ...segment, value: Number(parts[segment.key] ?? 0) }))
      const total = items.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0)
      if (total <= 0) return h('div', { className: 'chp-empty' }, '暂无构成数据。')
      const rows = items.filter(item => item.value > 0).map(item => h('tr', { key: item.key },
        h('td', null,
          h('span', { className: 'chp-dot', style: { background: item.color, marginRight: '7px' } }),
          item.label),
        h('td', { className: 'num' }, fmt(item.value)),
        h('td', { className: 'num' }, pctText(item.value, total))))
      return h('div', null,
        h('div', { className: 'chp-bar', 'aria-label': '上下文构成' },
          items.filter(item => item.value > 0).map(item => h('div', {
            key: item.key,
            className: 'chp-seg',
            style: { width: `${(item.value / total) * 100}%`, background: item.color },
            title: `${item.label} ${fmt(item.value)}（${Math.round((item.value / total) * 100)}%）`,
          }))),
        h('table', { className: 'chp-table', style: { marginTop: '8px' } },
          h('thead', null, h('tr', null,
            h('th', null, '分段'),
            h('th', { className: 'num' }, 'tokens'),
            h('th', { className: 'num' }, '占比'))),
          h('tbody', null, rows)))
    }

    function MemoryTable(props) {
      const recent = props.memory.recent ?? []
      const onAction = props.onAction
      if (recent.length === 0) {
        return h('div', { className: 'chp-empty' }, '记忆库还是空的：对话结束会自动抽取，也可以用 context_hub_remember 手动写入。')
      }
      return h('table', { className: 'chp-table' },
        h('thead', null, h('tr', null,
          h('th', { className: 'num' }, '#'),
          h('th', null, '类型'),
          h('th', null, '范围'),
          h('th', { className: 'num' }, '置信'),
          h('th', { className: 'num' }, '使用'),
          h('th', null, '内容'),
          h('th', null, '操作'))),
        h('tbody', null, recent.map(item => h('tr', { key: item.id },
          h('td', { className: 'num chp-mono' }, `#${item.id}`),
          h('td', null, h(Badge, { kind: item.kind }, KIND_LABELS[item.kind] ?? item.kind)),
          h('td', null, item.scope),
          h('td', { className: 'num' }, item.confidence === undefined ? '—' : String(item.confidence)),
          h('td', { className: 'num' }, String(item.uses ?? 0)),
          h('td', { className: 'chp-celltext', title: item.text }, item.text),
          h('td', null, h('div', { className: 'chp-rowactions' },
            h('button', {
              type: 'button', className: 'chp-mini-btn', title: '遗忘（软删除，保留审计链）',
              onClick: () => { if (onAction) onAction({ action: 'forget', id: item.id }) },
            }, '遗忘'),
            h('button', {
              type: 'button', className: 'chp-mini-btn', title: '替换为新内容',
              onClick: () => {
                const next = window.prompt('替换为：', item.text)
                if (next && next.trim().length > 0 && onAction) onAction({ action: 'supersede', id: item.id, text: next.trim() })
              },
            }, '替换')))))))
    }

    function Tabs(props) {
      return h('div', { className: 'chp-tabs', role: 'tablist', 'aria-label': '面板分区' },
        props.tabs.map(tab => h('button', {
          key: tab.key,
          type: 'button',
          role: 'tab',
          'aria-selected': props.active === tab.key ? 'true' : 'false',
          className: `chp-tab${props.active === tab.key ? ' chp-tab-on' : ''}`,
          onClick: () => props.onChange(tab.key),
        },
          tab.label,
          tab.badge === undefined || tab.badge === null
            ? null
            : h('span', { className: `chp-tab-badge${tab.warn ? ' chp-tab-badge-warn' : ''}` }, tab.badge),
          tab.dot ? h('span', { className: 'chp-tab-dot', title: tab.dotTitle }) : null)))
    }

    function ReviewSection(props) {
      const items = props.items
      const onReview = props.onReview
      return h(Section, { title: '待审核', extra: `${items.length} 条` },
        h('div', { className: 'chp-note', style: { marginBottom: '8px' } },
          '低置信抽取先进入 pending；批准后才会被召回。'),
        h('div', { className: 'chp-review' }, items.map(row => h('div', { key: row.id, className: 'chp-review-row' },
          h('div', { className: 'chp-review-main' },
            h('div', { className: 'chp-mono chp-review-meta' }, `#${row.id} · ${row.kind}/${row.scope} · conf ${row.confidence}`),
            h('div', { className: 'chp-review-text' }, row.text)),
          h('div', { className: 'chp-review-actions' },
            h('button', {
              type: 'button', className: 'chp-mini-btn ok', title: '批准',
              onClick: () => { if (onReview) onReview(row.id, 'approve') },
            }, '✓ 批准'),
            h('button', {
              type: 'button', className: 'chp-mini-btn danger', title: '拒绝',
              onClick: () => { if (onReview) onReview(row.id, 'reject') },
            }, '✕ 拒绝'))))))
    }

    function Panel(props) {
      const { snapshot, failed, onRefresh, onClose, onToggleWatermark, onReview, onAction } = props
      const session = snapshot === null ? null : snapshot.session
      const memory = snapshot === null ? null : snapshot.memory
      const config = snapshot === null || snapshot.config === null || snapshot.config === undefined ? {} : snapshot.config
      const activity = snapshot === null ? [] : (snapshot.activity ?? [])
      const requests = snapshot === null ? [] : (snapshot.requests ?? [])
      const pressure = session === null || session === undefined ? undefined : session.pressure
      const contextWindow = session === null || session === undefined ? undefined : session.contextWindow
      const percent = pressure !== undefined && contextWindow
        ? Math.min(100, Math.round((pressure / contextWindow) * 100))
        : undefined

      const recentState = React.useState(true)
      const tabState = React.useState('overview')
      const recentExpanded = recentState[0]
      const setRecentExpanded = recentState[1]
      const tab = tabState[0]
      const setTab = tabState[1]

      const pendingItems = memory !== null && Array.isArray(memory.pendingItems) ? memory.pendingItems : []
      const tabs = [
        { key: 'overview', label: '概览' },
        {
          key: 'memory',
          label: '记忆',
          badge: memory === null ? undefined : String(memory.active),
          dot: pendingItems.length > 0,
          dotTitle: `${pendingItems.length} 条待审核`,
        },
        { key: 'observe', label: '观测' },
        { key: 'config', label: '配置' },
      ]

      const sections = []
      if (snapshot === null) {
        sections.push(h('div', { key: 'loading', className: 'chp-empty' },
          failed === null ? '载入中…' : `数据不可用：${failed}`))
      } else {
        if (failed !== null && failed !== undefined) {
          sections.push(h('p', { key: 'failed', className: 'chp-alert' }, `操作失败：${failed}`))
        }
        if (snapshot.openError !== null && snapshot.openError !== undefined) {
          sections.push(h('p', { key: 'warning', className: 'chp-alert' }, `记忆库不可用：${snapshot.openError}`))
        }

        if (tab === 'overview') {
          if (pendingItems.length > 0) {
            sections.push(h('button', {
              key: 'pending-callout',
              type: 'button',
              className: 'chp-callout',
              onClick: () => setTab('memory'),
            },
              h('span', { className: 'chp-callout-dot' }),
              h('span', { className: 'chp-callout-text' }, `${pendingItems.length} 条记忆待审核`),
              h('span', { className: 'chp-callout-go' }, '去审核 →')))
          }
          if (session !== null && session !== undefined) {
            sections.push(h(Section, { key: 'parts', title: '上下文构成', extra: 'system / tools 未拆' },
              h(Composition, { parts: session.parts })))
          }

          if (requests.length > 0) {
            const series = requests.slice(0, 20).reverse()
            const totals = series.map(item => Number(item.estTokens) || 0)
            const injections = series.map(item => Number(item.injected) || 0)
            const avgOf = values => (values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length))
            const totalAvg = avgOf(totals)
            const injectAvg = avgOf(injections)
            const injectRatio = totalAvg > 0 ? Math.round((injectAvg / totalAvg) * 100) : 0
            const usageSamples = requests.filter(item => item.usage !== undefined)
            let usageLine = null
            if (usageSamples.length > 0) {
              const input = usageSamples.reduce((sum, item) => sum + Number(item.usage.input ?? 0), 0)
              const cacheRead = usageSamples.reduce((sum, item) => sum + Number(item.usage.cacheRead ?? 0), 0)
              const output = usageSamples.reduce((sum, item) => sum + Number(item.usage.output ?? 0), 0)
              const cacheRate = input + cacheRead > 0 ? Math.round((cacheRead / (input + cacheRead)) * 100) : 0
              usageLine = `缓存命中 ${cacheRate}% · input ${fmt(input)} / cache read ${fmt(cacheRead)} / output ${fmt(output)}`
            }
            sections.push(h(Section, { key: 'cost', title: '成本曲线', extra: `最近 ${series.length} 次主请求 · 左旧右新` },
              h('div', { className: 'chp-grid2' },
                h('div', null,
                  h('div', { className: 'chp-mini-title' }, '总估算 tokens'),
                  h(Sparkline, { values: totals }),
                  h('div', { className: 'chp-note' }, `均值 ${fmt(totalAvg)} · 峰值 ${fmt(Math.max(0, ...totals))}`)),
                h('div', null,
                  h('div', { className: 'chp-mini-title' }, '注入 tokens'),
                  h(Sparkline, { values: injections, color: 'var(--dsw-alias-state-success-primary,#10b981)' }),
                  h('div', { className: 'chp-note' }, `均值 ${fmt(injectAvg)} · 占总量 ${(injectRatio < 10 ? injectRatio.toFixed(1) : Math.round(injectRatio))}%`))),
              usageLine === null ? null : h('div', { className: 'chp-note' }, usageLine)))
          }

          if (activity.length > 0) {
            const top = [...activity].sort((a, b) => b.count - a.count).slice(0, 5)
            const max = Math.max(1, ...top.map(entry => entry.count))
            sections.push(h(Section, { key: 'activity-top', title: '活动', extra: `Top 5 / 共 ${activity.length} 类` },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '事件'),
                  h('th', { className: 'num' }, '次数'),
                  h('th', { style: { width: '36%' } }, '分布'))),
                h('tbody', null, top.map(entry => h('tr', { key: entry.kind },
                  h('td', null, ACTIVITY_LABELS[entry.kind] ?? entry.kind),
                  h('td', { className: 'num' }, String(entry.count)),
                  h('td', null, h(Track, {
                    percent: (entry.count / max) * 100,
                    color: 'var(--dsw-alias-state-business-primary,#2563eb)',
                  }))))))))
          }
        }

        if (tab === 'memory') {
          const memoryItems = [
            { key: 'active', label: '有效', value: fmt(memory.active) },
            { key: 'pending', label: '待审核', value: fmt(memory.pending ?? 0) },
            { key: 'superseded', label: '已替换', value: fmt(memory.superseded) },
            { key: 'archived', label: '已归档', value: fmt(memory.archived) },
            { key: 'messages', label: '消息索引', value: fmt(memory.messages ?? 0) },
          ]
          const scopeItems = SCOPES.map(scope => ({ ...scope, value: Number(memory.scopes?.[scope.key] ?? 0) }))
          const kindItems = Object.keys(KIND_LABELS)
            .filter(kind => kind !== 'summary')
            .map(kind => ({ key: kind, label: KIND_LABELS[kind], color: KIND_COLORS[kind], value: Number(memory.kinds?.[kind] ?? 0) }))
          sections.push(h(Section, {
            key: 'memory',
            title: '记忆库',
            extra: `${fmt(memory.active)} 有效 · ${fmt(memory.pending ?? 0)} 待审`,
          },
            h('div', { className: 'chp-tiles' }, memoryItems.map(item => h(Tile, {
              key: item.key,
              label: item.label,
              value: item.value,
            }))),
            h('div', { className: 'chp-grid2' },
              h('div', null,
                h('div', { className: 'chp-mini-title' }, '按范围'),
                h(Bars, { items: scopeItems })),
              h('div', null,
                h('div', { className: 'chp-mini-title' }, '按类型'),
                h(Bars, { items: kindItems }))),
            h('div', { style: { marginTop: '12px' } },
              h('button', {
                type: 'button',
                className: 'chp-disclosure',
                'aria-expanded': recentExpanded ? 'true' : 'false',
                title: recentExpanded ? '收起最近使用' : '展开最近使用',
                onClick: () => { setRecentExpanded(!recentExpanded) },
              },
                h('span', { className: 'chp-tri', style: { transform: recentExpanded ? 'rotate(90deg)' : 'rotate(0deg)' } }),
                h('span', null, '最近使用'),
                h('span', { className: 'chp-mono', style: { fontWeight: 400, letterSpacing: 0 } }, `${(memory.recent ?? []).length} 条`)),
              recentExpanded ? h('div', { style: { marginTop: '6px' } }, h(MemoryTable, { memory, onAction })) : null),
            h('div', { className: 'chp-note' }, `存储：${snapshot.db}`)))

          if (pendingItems.length > 0) {
            sections.push(h(ReviewSection, { key: 'review', items: pendingItems, onReview }))
          }
        }

        if (tab === 'observe') {
          if (session !== null && session !== undefined) {
            const folded = session.folded ?? { count: 0, tokens: 0 }
            const injected = Number(session.parts?.injected ?? 0)
            const usageRows = [
              {
                key: 'pressure',
                label: '压力 / 窗口',
                value: `${fmt(pressure)} / ${fmt(contextWindow)}`,
                percent: percent ?? 0,
                color: 'var(--dsw-alias-state-business-primary,#2563eb)',
              },
              {
                key: 'injected',
                label: '注入（context-hub）',
                value: `${fmt(injected)} tokens`,
                percent: session.surfaceTokens > 0 ? (injected / session.surfaceTokens) * 100 : 0,
                color: 'var(--dsw-alias-state-success-primary,#10b981)',
              },
              {
                key: 'reserve',
                label: '输出预留',
                value: `${fmt(session.outputReserve)} tokens`,
                percent: session.totalTokens > 0 ? (session.outputReserve / session.totalTokens) * 100 : 0,
                color: 'var(--dsw-alias-label-dimmed,#94a3b8)',
              },
              {
                key: 'folded',
                label: '已折叠',
                value: `${fmt(folded.count)} 个区间 · ${fmt(folded.tokens)} tokens`,
                percent: (folded.tokens + session.surfaceTokens) > 0
                  ? (folded.tokens / (folded.tokens + session.surfaceTokens)) * 100
                  : 0,
                color: '#8b5cf6',
              },
            ]
            sections.push(h(Section, { key: 'usage', title: '上下文明细' },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '指标'),
                  h('th', { className: 'num' }, '数值'),
                  h('th', { style: { width: '30%' } }, '占比'))),
                h('tbody', null, usageRows.map(row => h('tr', { key: row.key },
                  h('td', null, row.label),
                  h('td', { className: 'num' }, row.value),
                  h('td', null, h(Track, { percent: row.percent, color: row.color, title: `${row.percent.toFixed(1)}%` })))))))) 
          }

          if (activity.length > 0) {
            const sorted = [...activity].sort((a, b) => b.count - a.count)
            const max = Math.max(1, ...sorted.map(entry => entry.count))
            sections.push(h(Section, { key: 'activity', title: '活动', extra: `${sorted.length} 类事件` },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '事件'),
                  h('th', { className: 'num' }, '次数'),
                  h('th', { style: { width: '34%' } }, '分布'))),
                h('tbody', null, sorted.slice(0, 10).map(entry => h('tr', { key: entry.kind },
                  h('td', null, ACTIVITY_LABELS[entry.kind] ?? entry.kind),
                  h('td', { className: 'num' }, String(entry.count)),
                  h('td', null, h(Track, {
                    percent: (entry.count / max) * 100,
                    color: 'var(--dsw-alias-state-business-primary,#2563eb)',
                  }))))))))
          }

          if (requests.length > 0) {
            const max = Math.max(1, ...requests.map(item => Number(item.estTokens ?? 0)))
            const requestRows = requests.slice(0, 5).map((item, index) => h('tr', { key: index },
              h('td', null, item.purpose ?? 'chat'),
              h('td', { className: 'chp-celltext', title: `${item.provider ?? ''}/${item.model ?? ''}` }, item.model ?? '—'),
              h('td', { className: 'num' }, `${fmt(item.estTokens)}`),
              h('td', { className: 'num' }, `${fmt(item.injected)}`),
              h('td', null, h(Track, {
                percent: (Number(item.estTokens ?? 0) / max) * 100,
                color: 'var(--dsw-alias-label-dimmed,#94a3b8)',
              }))))
            const laneSample = requests.find(item => item.lanes !== undefined)?.lanes
            const laneLine = laneSample === undefined ? null
              : `最近召回车道：${laneSample.via ?? '—'} · ${laneSample.ids?.length ?? 0} 条 · ${laneSample.tokens ?? 0} 字符 · ${laneSample.messages ?? 0} 个来源消息`
            sections.push(h(Section, { key: 'requests', title: '最近主请求', extra: `共 ${requests.length} 次采样` },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '用途'),
                  h('th', null, '模型'),
                  h('th', { className: 'num' }, '估算'),
                  h('th', { className: 'num' }, '注入'),
                  h('th', { style: { width: '22%' } }, '分布'))),
                h('tbody', null, requestRows)),
              laneLine === null ? null : h('div', { className: 'chp-note' }, laneLine)))
          }

          if (session === null || session === undefined) {
            sections.push(h('div', { key: 'noobs', className: 'chp-empty' }, '当前没有打开的会话，缺少上下文观测数据。'))
          }
        }

        if (tab === 'config') {
          const configRows = [
            ['模式', config.mode ?? 'auto'],
            ...(snapshot.compactorState !== null && snapshot.compactorState !== undefined && snapshot.compactor !== 'hub'
              ? [['压缩器状态', snapshot.compactorState]]
              : []),
            ['召回预算', `${config.recallMaxItems} 条 / ${config.recallMaxChars} 字符 · 冷却 ${config.cooldown} 轮`],
            ['TTL', `session ${config.sessionTtlDays} 天 · project ${config.projectTtlDays} 天`],
            ['抽取 / 冲突', `${config.extractPasses} 次/轮 · ${config.conflictPolicy}`],
            ['语义召回', `向量 ${config.embedding === true ? `开（${config.fusion ?? 'weighted'}）` : '关'} · 改写 ${config.rewrite === true ? '开' : '关'}`],
            ['水位保留', `${config.watermarkRetainTurns ?? 0} 轮 / ${config.watermarkRetainTokens ?? 0} tokens`],
          ]
          sections.push(h(Section, { key: 'config', title: '运行参数' },
            h('table', { className: 'chp-table' },
              h('thead', null, h('tr', null, h('th', null, '项'), h('th', { className: 'num' }, '值'))),
              h('tbody', null, configRows.map(([key, value]) => h('tr', { key },
                h('td', null, key),
                h('td', { className: 'num' }, value)))))
            ))
          const toggles = [
            h('div', { key: 'watermark', className: 'chp-toggle' },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: '12px' } },
                  `水位压缩：${config.watermark === true ? '开' : '关'}`),
                h('div', { className: 'chp-sec-extra', style: { textTransform: 'none', letterSpacing: 0 } },
                  '持久化到记忆库；压缩仍由原生 compactRegion 执行')),
              h('button', {
                type: 'button',
                className: `chp-switch${config.watermark === true ? ' chp-switch-on' : ''}`,
                'aria-label': config.watermark === true ? '关闭水位压缩' : '开启水位压缩',
                'aria-pressed': config.watermark === true,
                onClick: () => { if (onToggleWatermark) onToggleWatermark() },
              }, h('span', { className: 'chp-knob' }))),
            h('div', { key: 'compactor', className: 'chp-toggle' },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: '12px' } },
                  `压缩器：${snapshot.compactor === 'hub' ? 'hub · 8 段' : 'native'}`),
                h('div', { className: 'chp-sec-extra', style: { textTransform: 'none', letterSpacing: 0 } },
                  'hub 换摘要提示词；失败自动回退')),
              h('button', {
                type: 'button', className: 'chp-mini-btn',
                onClick: () => { if (onAction) onAction({ action: 'compactor', value: snapshot.compactor === 'hub' ? 'native' : 'hub' }) },
              }, snapshot.compactor === 'hub' ? '切到 native' : '切到 hub')),
            h('div', { key: 'mode', className: 'chp-toggle' },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: '12px' } },
                  `接管模式：${config.mode ?? 'auto'}`),
                h('div', { className: 'chp-sec-extra', style: { textTransform: 'none', letterSpacing: 0 } },
                  'observe / assist / takeover / full')),
              h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                ['observe', 'assist', 'takeover', 'full'].map(mode => h('button', {
                  key: mode, type: 'button', className: 'chp-mini-btn',
                  disabled: config.mode === mode,
                  style: config.mode === mode ? { opacity: 0.45, cursor: 'default' } : undefined,
                  onClick: () => { if (onAction && config.mode !== mode) onAction({ action: 'mode', value: mode }) },
                }, mode)))),
          ]
          sections.push(h('div', { key: 'toggles' }, toggles))
          sections.push(h('div', { key: 'storage', className: 'chp-note' }, `存储：${snapshot.db}`))
        }
      }

      const sessionLabel = session !== null && session !== undefined && session.id
        ? `会话 ${String(session.id).slice(0, 8)}…`
        : '记忆与压缩的只读视图'
      const updated = snapshot === null
        ? '尚未载入'
        : `更新于 ${new Date(snapshot.generatedAt).toLocaleTimeString()}`

      return h('div', {
        id: 'chp-backdrop',
        onClick: (event) => { if (event.target === event.currentTarget) onClose() },
        role: 'presentation',
      }, h('div', {
        className: 'chp-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '上下文中枢面板',
      },
        h('div', { className: 'chp-head' },
          h('div', { className: 'chp-logo' }, 'CH'),
          h('div', { className: 'chp-titles' },
            h('h2', { className: 'chp-title' }, '上下文中枢'),
            h('div', { className: 'chp-sub' }, `${sessionLabel} · 只读`)),
          h('div', { className: 'chp-actions' },
            h('button', { type: 'button', className: 'chp-icon', title: '刷新', onClick: onRefresh }, '↻'),
            h('button', { type: 'button', className: 'chp-icon', title: '关闭（Esc）', onClick: onClose, autoFocus: true }, '✕'))),
        session === null || session === undefined
          ? h('div', { className: 'chp-kpi' },
            h('div', { className: 'chp-empty' }, snapshot === null ? '载入中…' : '当前没有打开的会话，只显示记忆库。'))
          : h('div', { className: 'chp-kpi' },
            h('div', { className: 'chp-hero' },
              h('div', { className: 'chp-ring' },
                ring(percent ?? 0, 78, 7, 'var(--dsw-alias-state-business-primary, #2563eb)'),
                h('div', { className: 'chp-ring-label' },
                  h('div', { className: 'chp-ring-num' }, percent === undefined ? '—' : `${percent}%`),
                  h('div', { className: 'chp-ring-cap' }, '压力'))),
              h('div', { className: 'chp-stats' },
                h(Stat, { label: 'surface', value: `${fmt(session.surfaceTokens)} tokens`, title: String(session.surfaceTokens) }),
                h(Stat, { label: '合计', value: `${fmt(session.totalTokens)} tokens`, title: String(session.totalTokens) }),
                h(Stat, { label: '节点 / 事件', value: `${fmt(session.nodes)} / ${fmt(session.events)}` }),
                h(Stat, { label: '输出预留', value: `${fmt(session.outputReserve)} tokens` })))),
        snapshot === null ? null : h(Tabs, { tabs, active: tab, onChange: setTab }),
        h('div', { className: 'chp-scroll' }, sections),
        h('div', { className: 'chp-foot' },
          h('span', null, '数据来自宿主 tokenMeter、记忆库与会话事件日志'),
          h('span', null, `${updated} · 打开时每 10s 刷新`))))
    }

    function Pill(props) {
      const sessionId = props.sessionId
      const [snapshot, setSnapshot] = React.useState(null)
      const [failed, setFailed] = React.useState(null)
      const [open, setOpen] = React.useState(false)

      const load = React.useCallback((signal) => fetch(
        `${PATH}?sessionId=${encodeURIComponent(String(sessionId ?? ''))}&t=${Date.now()}`,
        { signal, credentials: 'same-origin' },
      ).then(response => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
        .then(json => {
          if (signal !== undefined && signal.aborted) return
          setSnapshot(json)
          if (json.ok === false) setFailed(String(json.error ?? '未知错误'))
          else setFailed(null)
        })
        .catch(error => { if (signal === undefined || !signal.aborted) setFailed(String(error)) }), [sessionId])

      React.useEffect(() => {
        const controller = new AbortController()
        load(controller.signal)
        if (!open) return () => controller.abort()
        const timer = setInterval(() => load(controller.signal), 10000)
        return () => { controller.abort(); clearInterval(timer) }
      }, [load, open])

      React.useEffect(() => {
        if (!open) return undefined
        ensureStyle()
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      React.useEffect(() => { ensureStyle() }, [])

      const toggleWatermark = React.useCallback(async () => {
        const current = snapshot !== null && snapshot.config !== null && snapshot.config !== undefined
          ? snapshot.config.watermark === true
          : false
        try {
          const response = await fetch(WATERMARK_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: current !== true }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await load()
        } catch (error) {
          setFailed(String(error))
        }
      }, [snapshot, load])

      const reviewAction = React.useCallback(async (id, action) => {
        try {
          const response = await fetch(REVIEW_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, action }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await load()
        } catch (error) {
          setFailed(String(error))
        }
      }, [load])

      const runAction = React.useCallback(async (payload) => {
        try {
          const response = await fetch(ACTION_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await load()
        } catch (error) {
          setFailed(String(error))
        }
      }, [load])

      const memory = snapshot !== null && snapshot.memory !== null ? snapshot.memory.active : undefined
      const pending = snapshot !== null && snapshot.memory !== null ? snapshot.memory.pending : undefined
      const pressure = snapshot !== null && snapshot.session !== null ? snapshot.session.pressure : undefined
      const contextWindow = snapshot !== null && snapshot.session !== null ? snapshot.session.contextWindow : undefined
      const percent = pressure !== undefined && contextWindow ? Math.round((pressure / contextWindow) * 100) : undefined

      const label = snapshot === null
        ? (failed === null ? '上下文中枢 · 载入…' : '上下文中枢 · 不可用')
        : `上下文 ${percent === undefined ? '—' : `${percent}%`}`

      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: 'chp-pill',
          title: pending ? `打开上下文中枢面板（${pending} 条待审核）` : '打开上下文中枢面板',
          onClick: () => setOpen(value => !value),
        },
          percent === undefined ? null : ring(percent, 18, 2.5, 'var(--dsw-alias-state-business-primary, #2563eb)'),
          h('span', { className: 'chp-pill-strong' }, label),
          h('span', { className: 'chp-pill-dim' }, `· 记忆 ${memory ?? '—'}`),
          pending ? h('span', { className: 'chp-pill-warn', title: `${pending} 条待审核` }) : null),
        open ? createPortal(h(Panel, {
          snapshot,
          failed,
          onRefresh: () => { setFailed(null); load() },
          onToggleWatermark: toggleWatermark,
          onReview: reviewAction,
          onAction: runAction,
          onClose: () => setOpen(false),
        }), document.body) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'context-hub-status',
          order: 2,
        }, Pill))
      },
    }
  },
})

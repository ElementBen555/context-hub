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

    /* ---- 前端国际化字典 ---- */
    const DICT = {
      zh: {
        tabOverview: '概览', tabMemory: '记忆', tabObserve: '观测', tabConfig: '配置', tabLocale: '语言',
        panelTitle: '上下文中枢', panelSubReadonly: '记忆与压缩的只读视图', panelSubSession: (id) => `会话 ${id}…`,
        refresh: '刷新', close: '关闭（Esc）', loading: '载入中…',
        sectionContext: '上下文构成', sectionLedger: '压缩账本', sectionReadonly: '只读 · 不接管原生压缩',
        sectionActivity: '活动趋势', sectionRequests: '请求采样', sectionUsage: '使用统计',
        sectionKinds: '记忆类型', sectionScopes: '记忆范围', sectionRecent: '最近记忆',
        sectionPending: '待审核', sectionReview: '审核', sectionEvents: '事件',
        sectionCost: '成本曲线', sectionMemory: '记忆库', sectionDetail: '上下文明细', sectionConfig: '配置',
        sectionPartsExtra: 'system / tools 未拆', sectionSeriesExtra: (n) => `最近 ${n} 次主请求 · 左旧右新`,
        sectionActivityTop: (n) => `Top 5 / 共 ${n} 类`, sectionActivityCount: (n) => `${n} 类事件`,
        sectionRequestsExtra: (n) => `共 ${n} 次采样`, sectionPendingExtra: (n) => `${n} 条`,
        subSuffix: '会话只读 · 治理可写', noSession: '当前没有打开的会话，只显示记忆库。',
        noSessionObs: '当前没有打开的会话，缺少上下文观测数据。',
        updatedAt: (time) => `更新于 ${time}`,
        pillTitle: '打开上下文中枢面板', pillTitlePending: (n) => `打开上下文中枢面板（${n} 条待审核）`,
        pillLoading: '上下文中枢 · 载入…', pillUnavailable: '上下文中枢 · 不可用',
        pillContext: (p) => `上下文 ${p}`, pillMemory: (n) => `· 记忆 ${n}`,
        sectionRecall: '召回预算', sectionTtl: '记忆 TTL', sectionExtract: '抽取与冲突',
        localeTitle: '🌐 语言设置', localeHint: '切换语言后，面板和命令输出将立即更新为新语言。设置会持久化到记忆库。',
        localeCurrent: '当前设置', localeCurrentLang: '当前语言：', localeCommand: '命令：',
        useThisLang: '使用此语言', langEnabled: '已启用', autoDetect: '自动检测', autoDetectDesc: '跟随系统语言',
        ctxPressure: '上下文压力', ctxTokens: 'Token 使用', ctxTurns: '对话轮数', ctxCompression: '压缩率',
        memTotal: '总数', memSession: '会话', memProject: '项目', memGlobal: '全局',
        hitRate: '命中率', avgLatency: '平均延迟', timeoutRate: '超时率',
        recallItems: '条数', recallChars: '字符', recallCooldown: '冷却轮数', recallTokens: '硬顶', recallTimeout: '召回时限',
        ttlSession: 'session', ttlProject: 'project', ttlGlobal: 'global', ttlNever: '不过期', ttlPermanent: '永久',
        extractPasses: '抽取次数/轮', conflictPolicy: '冲突策略', policyEvidence: '新证据胜', policyRecency: '时间优先',
        capSearch: '检索', capRewrite: '改写', capRerank: '重排', capCompact: '压缩', capWatermark: '水位', capMode: '模式',
        semanticRecall: '语义召回', compactTakeover: '压缩与接管', watermarkOn: '开', watermarkOff: '关',
        goReview: '去审核 →', pendingCallout: (n) => `${n} 条记忆待审核`,
        storage: '存储',
        unknown: '—', unlimited: '不限', days: '天',
        yes: '是', no: '否',
        foldCount: '折叠次数', foldSaved: '累计节省', foldReask: '复问率', foldLast: '最近区间',
        foldRegion: '区间', foldShadowed: '折叠', foldSummary: '摘要', foldSaved2: '节省', foldReask2: '复问',
      },
      en: {
        tabOverview: 'Overview', tabMemory: 'Memory', tabObserve: 'Observe', tabConfig: 'Config', tabLocale: 'Language',
        panelTitle: 'Context Hub', panelSubReadonly: 'Read-only view of memory & compression', panelSubSession: (id) => `Session ${id}…`,
        refresh: 'Refresh', close: 'Close (Esc)', loading: 'Loading…',
        sectionContext: 'Context Composition', sectionLedger: 'Compaction Ledger', sectionReadonly: 'Read-only · does not override native',
        sectionActivity: 'Activity', sectionRequests: 'Request Samples', sectionUsage: 'Usage Stats',
        sectionKinds: 'Memory Types', sectionScopes: 'Memory Scopes', sectionRecent: 'Recent Memories',
        sectionPending: 'Pending Review', sectionReview: 'Review', sectionEvents: 'Events',
        sectionCost: 'Cost Curve', sectionMemory: 'Memory Store', sectionDetail: 'Context Detail', sectionConfig: 'Configuration',
        sectionPartsExtra: 'system / tools not split', sectionSeriesExtra: (n) => `last ${n} requests · oldest → newest`,
        sectionActivityTop: (n) => `Top 5 / ${n} kinds`, sectionActivityCount: (n) => `${n} event kinds`,
        sectionRequestsExtra: (n) => `${n} samples`, sectionPendingExtra: (n) => `${n} items`,
        subSuffix: 'session read-only · governance writable', noSession: 'No open session; showing memory store only.',
        noSessionObs: 'No open session; context observations unavailable.',
        updatedAt: (time) => `updated ${time}`,
        pillTitle: 'Open Context Hub panel', pillTitlePending: (n) => `Open Context Hub panel (${n} pending)`,
        pillLoading: 'Context Hub · loading…', pillUnavailable: 'Context Hub · unavailable',
        pillContext: (p) => `Context ${p}`, pillMemory: (n) => `· memory ${n}`,
        sectionRecall: 'Recall Budget', sectionTtl: 'Memory TTL', sectionExtract: 'Extraction & Conflict',
        localeTitle: '🌐 Language Settings', localeHint: 'Panel and command output will update immediately. Settings are persisted.',
        localeCurrent: 'Current Settings', localeCurrentLang: 'Current: ', localeCommand: 'Command: ',
        useThisLang: 'Use this language', langEnabled: 'Active', autoDetect: 'Auto-detect', autoDetectDesc: 'follow system language',
        ctxPressure: 'Context Pressure', ctxTokens: 'Token Usage', ctxTurns: 'Turns', ctxCompression: 'Compression',
        memTotal: 'Total', memSession: 'Session', memProject: 'Project', memGlobal: 'Global',
        hitRate: 'Hit Rate', avgLatency: 'Avg Latency', timeoutRate: 'Timeout Rate',
        recallItems: 'Items', recallChars: 'Chars', recallCooldown: 'Cooldown', recallTokens: 'Token Cap', recallTimeout: 'Timeout',
        ttlSession: 'session', ttlProject: 'project', ttlGlobal: 'global', ttlNever: 'never', ttlPermanent: 'permanent',
        extractPasses: 'Extracts/Turn', conflictPolicy: 'Conflict Policy', policyEvidence: 'evidence wins', policyRecency: 'recency wins',
        capSearch: 'Search', capRewrite: 'Rewrite', capRerank: 'Rerank', capCompact: 'Compact', capWatermark: 'Watermark', capMode: 'Mode',
        semanticRecall: 'Semantic Recall', compactTakeover: 'Compaction & Takeover', watermarkOn: 'on', watermarkOff: 'off',
        goReview: 'Review →', pendingCallout: (n) => `${n} memories pending review`,
        storage: 'Storage',
        unknown: '—', unlimited: 'unlimited', days: ' days',
        yes: 'Yes', no: 'No',
        foldCount: 'Folds', foldSaved: 'Tokens Saved', foldReask: 'Re-ask Rate', foldLast: 'Last Range',
        foldRegion: 'Range', foldShadowed: 'Folded', foldSummary: 'Summary', foldSaved2: 'Saved', foldReask2: 'Reask',
      },
      ja: {
        tabOverview: '概要', tabMemory: '記憶', tabObserve: '観測', tabConfig: '設定', tabLocale: '言語',
        panelTitle: 'コンテキストハブ', panelSubReadonly: '読み取り専用ビュー', panelSubSession: (id) => `セッション ${id}…`,
        refresh: '更新', close: '閉じる (Esc)', loading: '読み込み中…',
        sectionContext: 'コンテキスト構成', sectionLedger: '圧縮台帳', sectionReadonly: '読み取り専用',
        localeTitle: '🌐 言語設定', localeHint: 'パネルとコマンド出力が即時更新されます。設定は永続化されます。',
        localeCurrent: '現在の設定', localeCurrentLang: '現在の言語：', localeCommand: 'コマンド：',
        useThisLang: 'この言語を使用', langEnabled: '有効', autoDetect: '自動検出', autoDetectDesc: 'システム言語に従う',
        memTotal: '合計', memSession: 'セッション', memProject: 'プロジェクト', memGlobal: 'グローバル',
        recallItems: '件数', recallChars: '文字数', recallCooldown: '冷却', recallTokens: 'トークン上限',
        unknown: '—', days: '日',
      },
    }
    /* ---- 面板内全部可见文案（含子组件）---- */
    const EXTRA = {
      zh: {
        activity: {
          recall: '召回', 'recall-miss': '召回未命中', extract: '抽取', compact: '压缩', summary: '摘要',
          request: '请求', probe: '探针', 'compact-hub': 'hub 压缩', 'compact-hub-fallback': 'hub 压缩回退',
          restore: '还原原文', abtest: '压缩 A/B', 'review-approve': '审核批准', 'review-reject': '审核拒绝',
          'embedding-start': '启动向量服务', 'embedding-ready': '向量服务就绪', 'embedding-start-error': '向量服务启动失败',
          'embedding-reset': '清旧向量', reembed: '重算向量', rewrite: '改写', 'rewrite-error': '改写失败',
          'rewrite-empty': '改写空输出', 'rewrite-retry': '改写重试', rerank: '重排', 'rerank-error': '重排失败',
          'rerank-empty': '重排空输出', watermark: '水位压缩', 'watermark-error': '水位失败', 'watermark-toggle': '水位开关',
          'locale-change': '切换语言', forget: '遗忘', supersede: '替换',
        },
        seg: { user: '用户', assistant: '助手', tool: '工具', injected: '注入', summary: '摘要', other: '其他' },
        kind: { decision: '决策', fact: '事实', preference: '偏好', task: '任务', skill: '技能', summary: '摘要' },
        scope: { session: '会话', project: '项目', global: '全局' },
        pressure: '压力', stepDecrease: '减少', stepIncrease: '增加',
        noSamples: '暂无样本', noComposition: '暂无构成数据。', partsAria: '上下文构成',
        thSegment: '分段', thShare: '占比', thDistribution: '分布',
        thKind: '类型', thScope: '范围', thConfidence: '置信', thUses: '使用', thText: '内容', thActions: '操作',
        emptyMemories: '记忆库还是空的：对话结束会自动抽取，也可以用 context_hub_remember 手动写入。',
        forget: '遗忘', forgetTitle: '遗忘（软删除，保留审计链）',
        supersede: '替换', supersedeTitle: '替换为新内容',
        supersedePrompt: '替换为（原文未完整展示，请粘贴完整新内容）：',
        tabsAria: '面板分区',
        reviewHint: '低置信抽取先进入 pending；批准后才会被召回。',
        approve: '批准', reject: '拒绝',
        loadingDots: '载入中…', dataUnavailable: (e) => `数据不可用：${e}`, opFailed: (e) => `操作失败：${e}`,
        dbUnavailable: (e) => `记忆库不可用：${e}`, unknownError: '未知错误',
        thRange: '区间', thFolded: '折叠', thSummary: '摘要', thSaved: '节省', thReask: '复问',
        cacheHit: (i, c, o) => `缓存命中 · input ${i} / cache read ${c} / output ${o}`,
        totalTokens: '总估算 tokens', injectedTokens: '注入 tokens',
        avgPeak: (a, p) => `均值 ${a} · 峰值 ${p}`, avgShare: (a, s) => `均值 ${a} · 占总量 ${s}%`,
        thEvent: '事件', thCount: '次数', thMetric: '指标', thValue: '数值',
        memActive: '有效', memPending: '待审核', memSuperseded: '已替换', memArchived: '已归档', memMessages: '消息索引',
        activeExtra: (a, p) => `${a} 有效 · ${p} 待审`,
        byScope: '按范围', byType: '按类型', activeMemories: '有效记忆',
        collapseRecent: '收起最近使用', expandRecent: '展开最近使用', recentUses: '最近使用', itemsCount: (n) => `${n} 条`,
        graphInfo: (e, l) => `图谱：${e} 个实体 / ${l} 条链接（召回时 1-hop 补 ≤2 条）`,
        graphEmpty: '图谱：暂无实体（记忆写入时自动抽取）', linksCount: (n) => `${n} 条链接`,
        stressWindow: '压力 / 窗口', injectLabel: '注入（context-hub）', outputReserve: '输出预留',
        foldedLabel: '已折叠', foldedValue: (c, t) => `${c} 个区间 · ${t} tokens`,
        totalLabel: '合计', nodesEvents: '节点 / 事件',
        recallLane: (v, i, t, m) => `最近召回车道：${v} · ${i} 条 · ${t} 字符 · ${m} 个来源消息`,
        thPurpose: '用途', thModel: '模型', thEstimate: '估算', thInjected: '注入',
        recallBudget: '召回预算', ttlGroup: '记忆 TTL', extractGroup: '抽取与冲突',
        itemsLabel: (v) => `${v} 条`, charsLabel: (v) => `${v} 字符`, msLabel: (v) => `${v} ms`,
        on: '开', off: '关', dayUnit: (n) => `${n} 天`,
        watermarkTitle: (s) => `水位压缩：${s}`, watermarkHint: '持久化到记忆库；压缩仍由原生 compactRegion 执行',
        watermarkAriaOn: '开启水位压缩', watermarkAriaOff: '关闭水位压缩',
        compactorTitle: (v) => `压缩器：${v}`, compactorHubValue: 'hub · 8 段',
        compactorHint: 'hub 换摘要提示词；失败自动回退', switchToNative: '切到 native', switchToHub: '切到 hub',
        modeTitle: (v) => `接管模式：${v}`,
        vectorRecall: '向量召回', queryRewrite: '查询改写', llmRerank: 'LLM 重排',
        vectorHint: '需先在 profile 配 embedding.baseUrl/model',
        rewriteHint: '一次 LLM 调用把查询扩成同义词/英文关键词',
        rerankHint: '候选 10 条按相关度重排，失败回退原序',
        footerNote: '数据来自宿主 tokenMeter、记忆库与会话事件日志',
        kwFts: '关键词 + FTS5', capVectorFusion: (f) => `向量 · ${f}`,
        refreshedNote: (u) => `${u} · 打开时每 10s 刷新`,
        pendingBadge: (n) => `${n} 条待审核`,
        enable: '开启', disable: '关闭',
      },
      en: {
        activity: {
          recall: 'Recall', 'recall-miss': 'Recall Miss', extract: 'Extract', compact: 'Compact', summary: 'Summary',
          request: 'Request', probe: 'Probe', 'compact-hub': 'Hub Compact', 'compact-hub-fallback': 'Hub Compact Fallback',
          restore: 'Restore', abtest: 'Compaction A/B', 'review-approve': 'Review Approved', 'review-reject': 'Review Rejected',
          'embedding-start': 'Embedding Start', 'embedding-ready': 'Embedding Ready', 'embedding-start-error': 'Embedding Start Failed',
          'embedding-reset': 'Embedding Reset', reembed: 'Re-embed', rewrite: 'Rewrite', 'rewrite-error': 'Rewrite Failed',
          'rewrite-empty': 'Rewrite Empty', 'rewrite-retry': 'Rewrite Retry', rerank: 'Rerank', 'rerank-error': 'Rerank Failed',
          'rerank-empty': 'Rerank Empty', watermark: 'Watermark', 'watermark-error': 'Watermark Failed', 'watermark-toggle': 'Watermark Toggle',
          'locale-change': 'Locale Changed', forget: 'Forget', supersede: 'Supersede',
        },
        seg: { user: 'User', assistant: 'Assistant', tool: 'Tool', injected: 'Injected', summary: 'Summary', other: 'Other' },
        kind: { decision: 'Decision', fact: 'Fact', preference: 'Preference', task: 'Task', skill: 'Skill', summary: 'Summary' },
        scope: { session: 'Session', project: 'Project', global: 'Global' },
        pressure: 'Pressure', stepDecrease: 'Decrease', stepIncrease: 'Increase',
        noSamples: 'No samples', noComposition: 'No composition data.', partsAria: 'Context composition',
        thSegment: 'Segment', thShare: 'Share', thDistribution: 'Distribution',
        thKind: 'Kind', thScope: 'Scope', thConfidence: 'Conf.', thUses: 'Uses', thText: 'Content', thActions: 'Actions',
        emptyMemories: 'Memory store is empty: extraction runs at turn end, or write one with context_hub_remember.',
        forget: 'Forget', forgetTitle: 'Forget (soft delete, audit chain kept)',
        supersede: 'Supersede', supersedeTitle: 'Supersede with new content',
        supersedePrompt: 'New content (original not shown in full; paste the complete text):',
        tabsAria: 'Panel sections',
        reviewHint: 'Low-confidence extractions go to pending first; they are recalled only after approval.',
        approve: 'Approve', reject: 'Reject',
        loadingDots: 'Loading…', dataUnavailable: (e) => `Data unavailable: ${e}`, opFailed: (e) => `Operation failed: ${e}`,
        dbUnavailable: (e) => `Memory store unavailable: ${e}`, unknownError: 'unknown error',
        thRange: 'Range', thFolded: 'Folded', thSummary: 'Summary', thSaved: 'Saved', thReask: 'Reask',
        cacheHit: (i, c, o) => `cache hit · input ${i} / cache read ${c} / output ${o}`,
        totalTokens: 'Total est. tokens', injectedTokens: 'Injected tokens',
        avgPeak: (a, p) => `avg ${a} · peak ${p}`, avgShare: (a, s) => `avg ${a} · ${s}% of total`,
        thEvent: 'Event', thCount: 'Times', thMetric: 'Metric', thValue: 'Value',
        memActive: 'Active', memPending: 'Pending', memSuperseded: 'Superseded', memArchived: 'Archived', memMessages: 'Msg Index',
        activeExtra: (a, p) => `${a} active · ${p} pending`,
        byScope: 'By scope', byType: 'By type', activeMemories: 'active memories',
        collapseRecent: 'Collapse recent', expandRecent: 'Expand recent', recentUses: 'Recently used', itemsCount: (n) => `${n} items`,
        graphInfo: (e, l) => `Graph: ${e} entities / ${l} links (up to 2 via 1-hop on recall)`,
        graphEmpty: 'Graph: no entities yet (extracted when memories are written)', linksCount: (n) => `${n} links`,
        stressWindow: 'Pressure / window', injectLabel: 'Injected (context-hub)', outputReserve: 'Output reserve',
        foldedLabel: 'Folded', foldedValue: (c, t) => `${c} regions · ${t} tokens`,
        totalLabel: 'Total', nodesEvents: 'Nodes / events',
        recallLane: (v, i, t, m) => `Latest recall lane: ${v} · ${i} items · ${t} chars · ${m} source messages`,
        thPurpose: 'Purpose', thModel: 'Model', thEstimate: 'Est.', thInjected: 'Injected',
        recallBudget: 'Recall budget', ttlGroup: 'Memory TTL', extractGroup: 'Extraction & conflict',
        itemsLabel: (v) => `${v} items`, charsLabel: (v) => `${v} chars`, msLabel: (v) => `${v} ms`,
        on: 'on', off: 'off', dayUnit: (n) => `${n} days`,
        watermarkTitle: (s) => `Watermark: ${s}`, watermarkHint: 'Persisted to memory store; compaction still runs through native compactRegion',
        watermarkAriaOn: 'Turn watermark on', watermarkAriaOff: 'Turn watermark off',
        compactorTitle: (v) => `Compactor: ${v}`, compactorHubValue: 'hub · 8 sections',
        compactorHint: 'hub swaps the summary prompt; falls back automatically on failure', switchToNative: 'switch to native', switchToHub: 'switch to hub',
        modeTitle: (v) => `Mode: ${v}`,
        vectorRecall: 'Vector recall', queryRewrite: 'Query rewrite', llmRerank: 'LLM rerank',
        vectorHint: 'Configure embedding.baseUrl/model in the profile first',
        rewriteHint: 'One LLM call expands the query into synonyms/English keywords',
        rerankHint: 'Rerank 10 candidates by relevance; falls back to original order',
        footerNote: 'Data from host tokenMeter, memory store and session events',
        kwFts: 'keywords + FTS5', capVectorFusion: (f) => `vector · ${f}`,
        refreshedNote: (u) => `${u} · refreshes every 10s while open`,
        pendingBadge: (n) => `${n} pending`,
        enable: 'turn on', disable: 'turn off',
      },
      ja: {},
    }

    function lookupKey(obj, key) {
      if (obj === null || obj === undefined) return undefined
      // 允许扁平键（由构建脚本内联的外部词表使用），再回退到点路径
      if (typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]
      let node = obj
      for (const part of String(key).split('.')) {
        if (node === null || node === undefined || typeof node !== 'object') return undefined
        node = node[part]
      }
      return node
    }

    function tPanel(locale, key, ...args) {
      const v = lookupKey(EXTRA_MORE[locale], key)
        ?? lookupKey(EXTRA[locale], key)
        ?? lookupKey(DICT[locale], key)
        ?? lookupKey(EXTRA_MORE.en, key)
        ?? lookupKey(EXTRA.en, key)
        ?? lookupKey(DICT.en, key)
        ?? lookupKey(EXTRA.zh, key)
        ?? lookupKey(DICT.zh, key)
      if (typeof v === 'function') return v(...args)
      if (typeof v === 'string' && args.length > 0) {
        // 外部词表用 {0}/{1} 占位符，避免 JSON 里写函数
        let out = v
        for (let i = 0; i < args.length; i += 1) out = out.split(`{${i}}`).join(String(args[i]))
        return out
      }
      return v !== undefined ? v : key
    }

    /* i18n:extra-more:start */
    const EXTRA_MORE = {
      "ja": {
        "activeExtra": "{0} 件有効 · {1} 件保留中",
        "activeMemories": "有効な記憶",
        "activity.abtest": "圧縮 A/B",
        "activity.compact": "圧縮",
        "activity.compact-hub": "hub 圧縮",
        "activity.compact-hub-fallback": "hub 圧縮フォールバック",
        "activity.embedding-ready": "埋め込み準備完了",
        "activity.embedding-reset": "埋め込みリセット",
        "activity.embedding-start": "埋め込み起動",
        "activity.embedding-start-error": "埋め込み起動失敗",
        "activity.extract": "抽出",
        "activity.forget": "忘れる",
        "activity.locale-change": "言語切替",
        "activity.probe": "プローブ",
        "activity.recall": "検索",
        "activity.recall-miss": "検索ミス",
        "activity.reembed": "再埋め込み",
        "activity.request": "リクエスト",
        "activity.rerank": "再ランク",
        "activity.rerank-empty": "再ランク空",
        "activity.rerank-error": "再ランク失敗",
        "activity.restore": "原文復元",
        "activity.review-approve": "審査承認",
        "activity.review-reject": "審査却下",
        "activity.rewrite": "書き換え",
        "activity.rewrite-empty": "書き換え空",
        "activity.rewrite-error": "書き換え失敗",
        "activity.rewrite-retry": "書き換え再試行",
        "activity.summary": "要約",
        "activity.supersede": "置換",
        "activity.watermark": "水位圧縮",
        "activity.watermark-error": "水位失敗",
        "activity.watermark-toggle": "水位切替",
        "approve": "承認",
        "autoDetect": "自動検出",
        "avgLatency": "平均遅延",
        "avgPeak": "平均 {0} · ピーク {1}",
        "avgShare": "平均 {0} · 合計の {1}%",
        "byScope": "範囲別",
        "byType": "種類別",
        "cacheHit": "キャッシュヒット · input {0} / cache read {1} / output {2}",
        "capCompact": "圧縮",
        "capMode": "モード",
        "capRerank": "再ランク",
        "capRewrite": "書き換え",
        "capSearch": "検索",
        "capVectorFusion": "ベクトル · {0}",
        "capWatermark": "水位",
        "charsLabel": "{0} 文字",
        "close": "閉じる（Esc）",
        "collapseRecent": "最近の使用を閉じる",
        "compactTakeover": "圧縮と引き継ぎ",
        "compactorHint": "hub は要約プロンプトを差し替え。失敗時は自動で戻す",
        "compactorHubValue": "hub · 8 セクション",
        "compactorTitle": "コンパクタ：{0}",
        "conflictPolicy": "競合ポリシー",
        "ctxCompression": "圧縮率",
        "ctxPressure": "コンテキスト圧迫",
        "ctxTokens": "トークン使用量",
        "ctxTurns": "会話ターン",
        "dataUnavailable": "データ利用不可：{0}",
        "dayUnit": "{0} 日",
        "days": "日",
        "dbUnavailable": "記憶ストア利用不可：{0}",
        "disable": "オフ",
        "emptyMemories": "記憶ストアは空です。ターン終了時に自動抽出されます。context_hub_remember で手動書き込みもできます。",
        "enable": "オン",
        "expandRecent": "最近の使用を開く",
        "extractGroup": "抽出と競合",
        "extractPasses": "抽出回数/ターン",
        "foldCount": "折りたたみ回数",
        "foldLast": "最新の区間",
        "foldReask": "再質問率",
        "foldReask2": "再質問",
        "foldRegion": "区間",
        "foldSaved": "累計節約",
        "foldSaved2": "節約",
        "foldShadowed": "折りたたみ",
        "foldSummary": "要約",
        "foldedLabel": "折りたたみ済み",
        "foldedValue": "{0} 区間 · {1} tokens",
        "footerNote": "データはホストの tokenMeter、記憶ストア、セッションイベントから取得",
        "forget": "忘れる",
        "forgetTitle": "忘れる（論理削除、監査チェーンは保持）",
        "goReview": "審査へ →",
        "graphEmpty": "グラフ：エンティティなし（記憶書き込み時に自動抽出）",
        "graphInfo": "グラフ：{0} エンティティ / {1} リンク（検索時に 1-hop で最大 2 件補完）",
        "hitRate": "ヒット率",
        "injectLabel": "注入（context-hub）",
        "injectedTokens": "注入 tokens",
        "itemsCount": "{0} 件",
        "itemsLabel": "{0} 件",
        "kind.decision": "決定",
        "kind.fact": "事実",
        "kind.preference": "好み",
        "kind.skill": "スキル",
        "kind.summary": "要約",
        "kind.task": "タスク",
        "kwFts": "キーワード + FTS5",
        "langEnabled": "有効",
        "linksCount": "{0} リンク",
        "llmRerank": "LLM 再ランク",
        "loading": "読み込み中…",
        "loadingDots": "読み込み中…",
        "localeCommand": "コマンド：",
        "localeCurrent": "現在の設定",
        "localeCurrentLang": "現在の言語：",
        "localeHint": "パネルとコマンド出力はすぐに更新されます。設定は記憶ストアに保存されます。",
        "localeTitle": "🌐 言語設定",
        "memActive": "有効",
        "memArchived": "アーカイブ済み",
        "memGlobal": "グローバル",
        "memMessages": "メッセージ索引",
        "memPending": "保留中",
        "memProject": "プロジェクト",
        "memSession": "セッション",
        "memSuperseded": "置換済み",
        "memTotal": "合計",
        "modeTitle": "モード：{0}",
        "msLabel": "{0} ms",
        "no": "いいえ",
        "noComposition": "構成データがありません。",
        "noSamples": "サンプルなし",
        "noSession": "開いているセッションがありません。記憶ストアのみ表示しています。",
        "noSessionObs": "開いているセッションがないため、コンテキスト観測データがありません。",
        "nodesEvents": "ノード / イベント",
        "off": "オフ",
        "on": "オン",
        "opFailed": "操作失敗：{0}",
        "outputReserve": "出力予約",
        "panelSubReadonly": "記憶と圧縮の読み取り専用ビュー",
        "panelSubSession": "セッション {0}…",
        "panelTitle": "コンテキストハブ",
        "partsAria": "コンテキスト構成",
        "pendingBadge": "{0} 件保留中",
        "pendingCallout": "{0} 件の記憶が審査待ち",
        "pillContext": "コンテキスト {0}",
        "pillLoading": "コンテキストハブ · 読み込み中…",
        "pillMemory": "· 記憶 {0}",
        "pillTitle": "コンテキストハブのパネルを開く",
        "pillTitlePending": "コンテキストハブのパネルを開く（{0} 件保留中）",
        "pillUnavailable": "コンテキストハブ · 利用不可",
        "policyEvidence": "新しい証拠を優先",
        "policyRecency": "時刻を優先",
        "pressure": "圧迫",
        "queryRewrite": "クエリ書き換え",
        "recallBudget": "検索予算",
        "recallChars": "文字数",
        "recallCooldown": "クールダウン",
        "recallItems": "件数",
        "recallLane": "最新の検索レーン：{0} · {1} 件 · {2} 文字 · {3} 件の元メッセージ",
        "recallTimeout": "検索タイムアウト",
        "recallTokens": "トークン上限",
        "recentUses": "最近の使用",
        "refresh": "更新",
        "refreshedNote": "{0} · 表示中は 10 秒ごとに更新",
        "reject": "却下",
        "rerankHint": "候補 10 件を関連度で再ランク。失敗時は元の順序",
        "reviewHint": "低信頼の抽出はまず保留に入り、承認後に検索対象になります。",
        "rewriteHint": "1 回の LLM 呼び出しでクエリを同義語/英語キーワードに拡張",
        "scope.global": "グローバル",
        "scope.project": "プロジェクト",
        "scope.session": "セッション",
        "sectionActivity": "活動",
        "sectionActivityCount": "{0} 種類のイベント",
        "sectionActivityTop": "上位 5 / 全 {0} 種類",
        "sectionConfig": "設定",
        "sectionContext": "コンテキスト構成",
        "sectionCost": "コスト曲線",
        "sectionDetail": "コンテキスト明細",
        "sectionEvents": "イベント",
        "sectionExtract": "抽出と競合",
        "sectionKinds": "記憶の種類",
        "sectionLedger": "圧縮台帳",
        "sectionMemory": "記憶ストア",
        "sectionPartsExtra": "system / tools は未分割",
        "sectionPending": "審査待ち",
        "sectionPendingExtra": "{0} 件",
        "sectionReadonly": "読み取り専用 · ネイティブ圧縮は上書きしない",
        "sectionRecall": "検索予算",
        "sectionRecent": "最近の記憶",
        "sectionRequests": "リクエストサンプル",
        "sectionRequestsExtra": "全 {0} 回のサンプル",
        "sectionReview": "審査",
        "sectionScopes": "記憶の範囲",
        "sectionSeriesExtra": "最近 {0} 回のリクエスト · 左が古い",
        "sectionTtl": "記憶 TTL",
        "sectionUsage": "使用統計",
        "seg.assistant": "アシスタント",
        "seg.injected": "注入",
        "seg.other": "その他",
        "seg.summary": "要約",
        "seg.tool": "ツール",
        "seg.user": "ユーザー",
        "semanticRecall": "意味検索",
        "stepDecrease": "減らす",
        "stepIncrease": "増やす",
        "storage": "保存先",
        "stressWindow": "圧迫 / ウィンドウ",
        "subSuffix": "セッションは読み取り専用 · ガバナンスは書き込み可",
        "supersede": "置換",
        "supersedePrompt": "置換後の内容（原文は全文表示されていません。完全なテキストを貼り付けてください）：",
        "supersedeTitle": "新しい内容で置換",
        "switchToHub": "hub に切替",
        "switchToNative": "native に切替",
        "tabConfig": "設定",
        "tabLocale": "言語",
        "tabMemory": "記憶",
        "tabObserve": "観測",
        "tabOverview": "概要",
        "tabsAria": "パネルのセクション",
        "thActions": "操作",
        "thConfidence": "信頼度",
        "thCount": "回数",
        "thDistribution": "分布",
        "thEstimate": "推定",
        "thEvent": "イベント",
        "thFolded": "折りたたみ",
        "thInjected": "注入",
        "thKind": "種類",
        "thMetric": "指標",
        "thModel": "モデル",
        "thPurpose": "用途",
        "thRange": "区間",
        "thReask": "再質問",
        "thSaved": "節約",
        "thScope": "範囲",
        "thSegment": "セグメント",
        "thShare": "割合",
        "thSummary": "要約",
        "thText": "内容",
        "thUses": "使用",
        "thValue": "値",
        "timeoutRate": "タイムアウト率",
        "totalLabel": "合計",
        "totalTokens": "推定 tokens 合計",
        "ttlGlobal": "global",
        "ttlGroup": "記憶 TTL",
        "ttlNever": "無期限",
        "ttlPermanent": "永久",
        "ttlProject": "project",
        "ttlSession": "session",
        "unknown": "—",
        "unknownError": "不明なエラー",
        "unlimited": "無制限",
        "updatedAt": "更新 {0}",
        "useThisLang": "この言語を使う",
        "vectorHint": "先に profile で embedding.baseUrl/model を設定してください",
        "vectorRecall": "ベクトル検索",
        "watermarkAriaOff": "水位圧縮をオフにする",
        "watermarkAriaOn": "水位圧縮をオンにする",
        "watermarkHint": "記憶ストアに保存。圧縮自体はネイティブの compactRegion が実行",
        "watermarkOff": "オフ",
        "watermarkOn": "オン",
        "watermarkTitle": "水位圧縮：{0}",
        "yes": "はい",
        "autoDetectDesc": "システム言語に従う"
      },
      "ko": {
        "activeExtra": "{0}개 활성 · {1}개 대기",
        "activeMemories": "활성 기억",
        "activity.abtest": "압축 A/B",
        "activity.compact": "압축",
        "activity.compact-hub": "hub 압축",
        "activity.compact-hub-fallback": "hub 압축 폴백",
        "activity.embedding-ready": "임베딩 준비 완료",
        "activity.embedding-reset": "임베딩 초기화",
        "activity.embedding-start": "임베딩 시작",
        "activity.embedding-start-error": "임베딩 시작 실패",
        "activity.extract": "추출",
        "activity.forget": "삭제",
        "activity.locale-change": "언어 변경",
        "activity.probe": "프로브",
        "activity.recall": "검색",
        "activity.recall-miss": "검색 실패",
        "activity.reembed": "재임베딩",
        "activity.request": "요청",
        "activity.rerank": "재순위",
        "activity.rerank-empty": "재순위 빈 응답",
        "activity.rerank-error": "재순위 실패",
        "activity.restore": "원문 복원",
        "activity.review-approve": "검토 승인",
        "activity.review-reject": "검토 거부",
        "activity.rewrite": "재작성",
        "activity.rewrite-empty": "재작성 빈 응답",
        "activity.rewrite-error": "재작성 실패",
        "activity.rewrite-retry": "재작성 재시도",
        "activity.summary": "요약",
        "activity.supersede": "대체",
        "activity.watermark": "수위 압축",
        "activity.watermark-error": "수위 실패",
        "activity.watermark-toggle": "수위 전환",
        "approve": "승인",
        "autoDetect": "자동 감지",
        "avgLatency": "평균 지연",
        "avgPeak": "평균 {0} · 최대 {1}",
        "avgShare": "평균 {0} · 전체의 {1}%",
        "byScope": "범위별",
        "byType": "유형별",
        "cacheHit": "캐시 적중 · input {0} / cache read {1} / output {2}",
        "capCompact": "압축",
        "capMode": "모드",
        "capRerank": "재순위",
        "capRewrite": "재작성",
        "capSearch": "검색",
        "capVectorFusion": "벡터 · {0}",
        "capWatermark": "수위",
        "charsLabel": "{0}자",
        "close": "닫기 (Esc)",
        "collapseRecent": "최근 사용 접기",
        "compactTakeover": "압축 및 인계",
        "compactorHint": "hub는 요약 프롬프트만 교체하며 실패하면 자동 복귀합니다",
        "compactorHubValue": "hub · 8개 섹션",
        "compactorTitle": "압축기: {0}",
        "conflictPolicy": "충돌 정책",
        "ctxCompression": "압축률",
        "ctxPressure": "컨텍스트 압박",
        "ctxTokens": "토큰 사용량",
        "ctxTurns": "대화 턴",
        "dataUnavailable": "데이터 사용 불가: {0}",
        "dayUnit": "{0}일",
        "days": "일",
        "dbUnavailable": "기억 저장소 사용 불가: {0}",
        "disable": "끄기",
        "emptyMemories": "기억 저장소가 비어 있습니다. 턴 종료 시 자동 추출되며 context_hub_remember로 직접 쓸 수도 있습니다.",
        "enable": "켜기",
        "expandRecent": "최근 사용 펼치기",
        "extractGroup": "추출 및 충돌",
        "extractPasses": "턴당 추출 횟수",
        "foldCount": "접힘 횟수",
        "foldLast": "최근 구간",
        "foldReask": "재질문률",
        "foldReask2": "재질문",
        "foldRegion": "구간",
        "foldSaved": "누적 절감",
        "foldSaved2": "절감",
        "foldShadowed": "접힘",
        "foldSummary": "요약",
        "foldedLabel": "접힘",
        "foldedValue": "{0}개 구간 · {1} tokens",
        "footerNote": "데이터는 호스트 tokenMeter, 기억 저장소, 세션 이벤트에서 가져옵니다",
        "forget": "삭제",
        "forgetTitle": "삭제 (소프트 삭제, 감사 체인 유지)",
        "goReview": "검토하기 →",
        "graphEmpty": "그래프: 아직 엔티티 없음 (기억 기록 시 자동 추출)",
        "graphInfo": "그래프: 엔티티 {0}개 / 링크 {1}개 (검색 시 1-hop 최대 2개 보완)",
        "hitRate": "적중률",
        "injectLabel": "주입 (context-hub)",
        "injectedTokens": "주입 tokens",
        "itemsCount": "{0}개",
        "itemsLabel": "{0}개",
        "kind.decision": "결정",
        "kind.fact": "사실",
        "kind.preference": "선호",
        "kind.skill": "스킬",
        "kind.summary": "요약",
        "kind.task": "작업",
        "kwFts": "키워드 + FTS5",
        "langEnabled": "사용 중",
        "linksCount": "링크 {0}개",
        "llmRerank": "LLM 재순위",
        "loading": "불러오는 중…",
        "loadingDots": "불러오는 중…",
        "localeCommand": "명령:",
        "localeCurrent": "현재 설정",
        "localeCurrentLang": "현재 언어:",
        "localeHint": "패널과 명령 출력이 즉시 바뀝니다. 설정은 기억 저장소에 저장됩니다.",
        "localeTitle": "🌐 언어 설정",
        "memActive": "활성",
        "memArchived": "보관됨",
        "memGlobal": "전역",
        "memMessages": "메시지 색인",
        "memPending": "대기 중",
        "memProject": "프로젝트",
        "memSession": "세션",
        "memSuperseded": "대체됨",
        "memTotal": "전체",
        "modeTitle": "모드: {0}",
        "msLabel": "{0} ms",
        "no": "아니오",
        "noComposition": "구성 데이터가 없습니다.",
        "noSamples": "샘플 없음",
        "noSession": "열린 세션이 없어 기억 저장소만 표시합니다.",
        "noSessionObs": "열린 세션이 없어 컨텍스트 관측 데이터가 없습니다.",
        "nodesEvents": "노드 / 이벤트",
        "off": "끄기",
        "on": "켜기",
        "opFailed": "작업 실패: {0}",
        "outputReserve": "출력 예약",
        "panelSubReadonly": "기억과 압축의 읽기 전용 보기",
        "panelSubSession": "세션 {0}…",
        "panelTitle": "컨텍스트 허브",
        "partsAria": "컨텍스트 구성",
        "pendingBadge": "{0}개 대기",
        "pendingCallout": "기억 {0}개가 검토 대기 중",
        "pillContext": "컨텍스트 {0}",
        "pillLoading": "컨텍스트 허브 · 불러오는 중…",
        "pillMemory": "· 기억 {0}",
        "pillTitle": "컨텍스트 허브 패널 열기",
        "pillTitlePending": "컨텍스트 허브 패널 열기 ({0}개 대기)",
        "pillUnavailable": "컨텍스트 허브 · 사용 불가",
        "policyEvidence": "새 증거 우선",
        "policyRecency": "시간 우선",
        "pressure": "압박",
        "queryRewrite": "쿼리 재작성",
        "recallBudget": "검색 예산",
        "recallChars": "문자 수",
        "recallCooldown": "쿨다운",
        "recallItems": "개수",
        "recallLane": "최근 검색 레인: {0} · {1}개 · {2}자 · 원본 메시지 {3}개",
        "recallTimeout": "검색 제한 시간",
        "recallTokens": "토큰 상한",
        "recentUses": "최근 사용",
        "refresh": "새로고침",
        "refreshedNote": "{0} · 열려 있는 동안 10초마다 갱신",
        "reject": "거부",
        "rerankHint": "후보 10개를 관련도로 재순위, 실패 시 원래 순서",
        "reviewHint": "낮은 신뢰도 추출은 먼저 대기로 가고 승인 후 검색됩니다.",
        "rewriteHint": "LLM 호출 1회로 쿼리를 동의어/영어 키워드로 확장",
        "scope.global": "전역",
        "scope.project": "프로젝트",
        "scope.session": "세션",
        "sectionActivity": "활동",
        "sectionActivityCount": "이벤트 {0}종",
        "sectionActivityTop": "상위 5 / 전체 {0}종",
        "sectionConfig": "설정",
        "sectionContext": "컨텍스트 구성",
        "sectionCost": "비용 곡선",
        "sectionDetail": "컨텍스트 상세",
        "sectionEvents": "이벤트",
        "sectionExtract": "추출 및 충돌",
        "sectionKinds": "기억 유형",
        "sectionLedger": "압축 원장",
        "sectionMemory": "기억 저장소",
        "sectionPartsExtra": "system / tools 미분리",
        "sectionPending": "검토 대기",
        "sectionPendingExtra": "{0}개",
        "sectionReadonly": "읽기 전용 · 네이티브 압축을 대체하지 않음",
        "sectionRecall": "검색 예산",
        "sectionRecent": "최근 기억",
        "sectionRequests": "요청 샘플",
        "sectionRequestsExtra": "총 {0}회 샘플",
        "sectionReview": "검토",
        "sectionScopes": "기억 범위",
        "sectionSeriesExtra": "최근 {0}회 요청 · 왼쪽이 오래됨",
        "sectionTtl": "기억 TTL",
        "sectionUsage": "사용 통계",
        "seg.assistant": "어시스턴트",
        "seg.injected": "주입",
        "seg.other": "기타",
        "seg.summary": "요약",
        "seg.tool": "도구",
        "seg.user": "사용자",
        "semanticRecall": "의미 검색",
        "stepDecrease": "줄이기",
        "stepIncrease": "늘리기",
        "storage": "저장소",
        "stressWindow": "압박 / 윈도우",
        "subSuffix": "세션 읽기 전용 · 거버넌스 쓰기 가능",
        "supersede": "대체",
        "supersedePrompt": "대체할 내용 (원문이 전체 표시되지 않았습니다. 전체 텍스트를 붙여넣으세요):",
        "supersedeTitle": "새 내용으로 대체",
        "switchToHub": "hub로 전환",
        "switchToNative": "native로 전환",
        "tabConfig": "설정",
        "tabLocale": "언어",
        "tabMemory": "기억",
        "tabObserve": "관측",
        "tabOverview": "개요",
        "tabsAria": "패널 섹션",
        "thActions": "작업",
        "thConfidence": "신뢰도",
        "thCount": "횟수",
        "thDistribution": "분포",
        "thEstimate": "추정",
        "thEvent": "이벤트",
        "thFolded": "접힘",
        "thInjected": "주입",
        "thKind": "유형",
        "thMetric": "지표",
        "thModel": "모델",
        "thPurpose": "용도",
        "thRange": "구간",
        "thReask": "재질문",
        "thSaved": "절감",
        "thScope": "범위",
        "thSegment": "구간",
        "thShare": "비율",
        "thSummary": "요약",
        "thText": "내용",
        "thUses": "사용",
        "thValue": "값",
        "timeoutRate": "시간 초과율",
        "totalLabel": "합계",
        "totalTokens": "추정 tokens 합계",
        "ttlGlobal": "global",
        "ttlGroup": "기억 TTL",
        "ttlNever": "만료 없음",
        "ttlPermanent": "영구",
        "ttlProject": "project",
        "ttlSession": "session",
        "unknown": "—",
        "unknownError": "알 수 없는 오류",
        "unlimited": "무제한",
        "updatedAt": "업데이트 {0}",
        "useThisLang": "이 언어 사용",
        "vectorHint": "먼저 profile에 embedding.baseUrl/model을 설정하세요",
        "vectorRecall": "벡터 검색",
        "watermarkAriaOff": "수위 압축 끄기",
        "watermarkAriaOn": "수위 압축 켜기",
        "watermarkHint": "기억 저장소에 저장되며 압축 자체는 네이티브 compactRegion이 수행",
        "watermarkOff": "끄기",
        "watermarkOn": "켜기",
        "watermarkTitle": "수위 압축: {0}",
        "yes": "예",
        "autoDetectDesc": "시스템 언어 따르기"
      },
      "de": {
        "activeExtra": "{0} aktiv · {1} ausstehend",
        "activeMemories": "aktive Erinnerungen",
        "activity.abtest": "Komprimierung A/B",
        "activity.compact": "Komprimieren",
        "activity.compact-hub": "Hub-Komprimierung",
        "activity.compact-hub-fallback": "Hub-Komprimierung Rückfall",
        "activity.embedding-ready": "Embedding bereit",
        "activity.embedding-reset": "Embedding zurückgesetzt",
        "activity.embedding-start": "Embedding starten",
        "activity.embedding-start-error": "Embedding-Start fehlgeschlagen",
        "activity.extract": "Extrahieren",
        "activity.forget": "Vergessen",
        "activity.locale-change": "Sprache gewechselt",
        "activity.probe": "Probe",
        "activity.recall": "Abruf",
        "activity.recall-miss": "Abruf ohne Treffer",
        "activity.reembed": "Neu einbetten",
        "activity.request": "Anfrage",
        "activity.rerank": "Neu ordnen",
        "activity.rerank-empty": "Neuordnung leer",
        "activity.rerank-error": "Neuordnung fehlgeschlagen",
        "activity.restore": "Originaltext wiederherstellen",
        "activity.review-approve": "Prüfung bestätigt",
        "activity.review-reject": "Prüfung abgelehnt",
        "activity.rewrite": "Umschreiben",
        "activity.rewrite-empty": "Umschreiben leer",
        "activity.rewrite-error": "Umschreiben fehlgeschlagen",
        "activity.rewrite-retry": "Umschreiben erneut",
        "activity.summary": "Zusammenfassung",
        "activity.supersede": "Ersetzen",
        "activity.watermark": "Wasserstand-Komprimierung",
        "activity.watermark-error": "Wasserstand fehlgeschlagen",
        "activity.watermark-toggle": "Wasserstand umschalten",
        "approve": "Bestätigen",
        "autoDetect": "Automatisch erkennen",
        "avgLatency": "Ø Latenz",
        "avgPeak": "Ø {0} · Spitze {1}",
        "avgShare": "Ø {0} · {1}% der Gesamtmenge",
        "byScope": "Nach Bereich",
        "byType": "Nach Typ",
        "cacheHit": "Cache-Treffer · Input {0} / Cache-Read {1} / Output {2}",
        "capCompact": "Komprimierung",
        "capMode": "Modus",
        "capRerank": "Neuordnung",
        "capRewrite": "Umschreiben",
        "capSearch": "Suche",
        "capVectorFusion": "Vektor · {0}",
        "capWatermark": "Wasserstand",
        "charsLabel": "{0} Zeichen",
        "close": "Schließen (Esc)",
        "collapseRecent": "Zuletzt verwendet einklappen",
        "compactTakeover": "Komprimierung & Übernahme",
        "compactorHint": "hub tauscht nur den Zusammenfassungs-Prompt, fällt bei Fehler zurück",
        "compactorHubValue": "hub · 8 Abschnitte",
        "compactorTitle": "Kompressor: {0}",
        "conflictPolicy": "Konfliktstrategie",
        "ctxCompression": "Kompressionsrate",
        "ctxPressure": "Kontextdruck",
        "ctxTokens": "Token-Nutzung",
        "ctxTurns": "Gesprächsrunden",
        "dataUnavailable": "Daten nicht verfügbar: {0}",
        "dayUnit": "{0} Tage",
        "days": "Tage",
        "dbUnavailable": "Speicher nicht verfügbar: {0}",
        "disable": "aus",
        "emptyMemories": "Der Speicher ist leer: Extraktion läuft am Rundenende, oder schreibe mit context_hub_remember.",
        "enable": "ein",
        "expandRecent": "Zuletzt verwendet ausklappen",
        "extractGroup": "Extraktion & Konflikt",
        "extractPasses": "Extraktionen/Runde",
        "foldCount": "Faltungen",
        "foldLast": "Letzter Bereich",
        "foldReask": "Rückfragequote",
        "foldReask2": "Rückfrage",
        "foldRegion": "Bereich",
        "foldSaved": "Gesamt gespart",
        "foldSaved2": "Gespart",
        "foldShadowed": "Gefaltet",
        "foldSummary": "Zusammenfassung",
        "foldedLabel": "Gefaltet",
        "foldedValue": "{0} Bereiche · {1} Tokens",
        "footerNote": "Daten aus Host-tokenMeter, Speicher und Session-Ereignissen",
        "forget": "Vergessen",
        "forgetTitle": "Vergessen (Soft-Delete, Audit-Kette bleibt)",
        "goReview": "Prüfen →",
        "graphEmpty": "Graph: noch keine Entitäten (werden beim Schreiben extrahiert)",
        "graphInfo": "Graph: {0} Entitäten / {1} Verknüpfungen (beim Abruf 1-Hop, max. 2)",
        "hitRate": "Trefferquote",
        "injectLabel": "Injiziert (context-hub)",
        "injectedTokens": "Injizierte Tokens",
        "itemsCount": "{0} Einträge",
        "itemsLabel": "{0} Einträge",
        "kind.decision": "Entscheidung",
        "kind.fact": "Fakt",
        "kind.preference": "Präferenz",
        "kind.skill": "Fähigkeit",
        "kind.summary": "Zusammenfassung",
        "kind.task": "Aufgabe",
        "kwFts": "Schlüsselwörter + FTS5",
        "langEnabled": "Aktiv",
        "linksCount": "{0} Verknüpfungen",
        "llmRerank": "LLM-Neuordnung",
        "loading": "Lädt…",
        "loadingDots": "Lädt…",
        "localeCommand": "Befehl:",
        "localeCurrent": "Aktuelle Einstellung",
        "localeCurrentLang": "Aktuelle Sprache:",
        "localeHint": "Panel und Befehlsausgabe wechseln sofort. Die Einstellung wird im Speicher gesichert.",
        "localeTitle": "🌐 Spracheinstellungen",
        "memActive": "Aktiv",
        "memArchived": "Archiviert",
        "memGlobal": "Global",
        "memMessages": "Nachrichtenindex",
        "memPending": "Ausstehend",
        "memProject": "Projekt",
        "memSession": "Sitzung",
        "memSuperseded": "Ersetzt",
        "memTotal": "Gesamt",
        "modeTitle": "Modus: {0}",
        "msLabel": "{0} ms",
        "no": "Nein",
        "noComposition": "Keine Zusammensetzungsdaten.",
        "noSamples": "Keine Stichproben",
        "noSession": "Keine offene Sitzung; es wird nur der Speicher angezeigt.",
        "noSessionObs": "Keine offene Sitzung; keine Kontext-Beobachtungsdaten.",
        "nodesEvents": "Knoten / Ereignisse",
        "off": "aus",
        "on": "ein",
        "opFailed": "Vorgang fehlgeschlagen: {0}",
        "outputReserve": "Ausgabereserve",
        "panelSubReadonly": "Schreibgeschützte Ansicht von Speicher und Komprimierung",
        "panelSubSession": "Sitzung {0}…",
        "panelTitle": "Kontext-Hub",
        "partsAria": "Kontextzusammensetzung",
        "pendingBadge": "{0} ausstehend",
        "pendingCallout": "{0} Erinnerungen warten auf Prüfung",
        "pillContext": "Kontext {0}",
        "pillLoading": "Kontext-Hub · lädt…",
        "pillMemory": "· Speicher {0}",
        "pillTitle": "Kontext-Hub-Panel öffnen",
        "pillTitlePending": "Kontext-Hub-Panel öffnen ({0} ausstehend)",
        "pillUnavailable": "Kontext-Hub · nicht verfügbar",
        "policyEvidence": "Neuer Beweis gewinnt",
        "policyRecency": "Zeit gewinnt",
        "pressure": "Druck",
        "queryRewrite": "Abfrage umschreiben",
        "recallBudget": "Abrufbudget",
        "recallChars": "Zeichen",
        "recallCooldown": "Abklingzeit",
        "recallItems": "Einträge",
        "recallLane": "Letzte Abrufspur: {0} · {1} Einträge · {2} Zeichen · {3} Quellnachrichten",
        "recallTimeout": "Abruf-Timeout",
        "recallTokens": "Token-Obergrenze",
        "recentUses": "Zuletzt verwendet",
        "refresh": "Aktualisieren",
        "refreshedNote": "{0} · aktualisiert alle 10 s bei offenem Panel",
        "reject": "Ablehnen",
        "rerankHint": "10 Kandidaten nach Relevanz neu ordnen; bei Fehler ursprüngliche Reihenfolge",
        "reviewHint": "Extraktionen mit geringer Konfidenz landen zuerst in „ausstehend“ und werden erst nach Bestätigung abgerufen.",
        "rewriteHint": "Ein LLM-Aufruf erweitert die Abfrage um Synonyme/englische Stichwörter",
        "scope.global": "Global",
        "scope.project": "Projekt",
        "scope.session": "Sitzung",
        "sectionActivity": "Aktivität",
        "sectionActivityCount": "{0} Ereignisarten",
        "sectionActivityTop": "Top 5 / {0} Arten",
        "sectionConfig": "Konfiguration",
        "sectionContext": "Kontextzusammensetzung",
        "sectionCost": "Kostenkurve",
        "sectionDetail": "Kontextdetails",
        "sectionEvents": "Ereignisse",
        "sectionExtract": "Extraktion & Konflikt",
        "sectionKinds": "Erinnerungstypen",
        "sectionLedger": "Komprimierungsjournal",
        "sectionMemory": "Speicher",
        "sectionPartsExtra": "system / tools nicht getrennt",
        "sectionPending": "Prüfung ausstehend",
        "sectionPendingExtra": "{0} Einträge",
        "sectionReadonly": "Schreibgeschützt · ersetzt keine native Komprimierung",
        "sectionRecall": "Abrufbudget",
        "sectionRecent": "Letzte Erinnerungen",
        "sectionRequests": "Anfrage-Stichproben",
        "sectionRequestsExtra": "{0} Stichproben",
        "sectionReview": "Prüfung",
        "sectionScopes": "Erinnerungsbereiche",
        "sectionSeriesExtra": "letzte {0} Anfragen · links älter",
        "sectionTtl": "Erinnerungs-TTL",
        "sectionUsage": "Nutzungsstatistik",
        "seg.assistant": "Assistent",
        "seg.injected": "Injiziert",
        "seg.other": "Sonstiges",
        "seg.summary": "Zusammenfassung",
        "seg.tool": "Werkzeug",
        "seg.user": "Benutzer",
        "semanticRecall": "Semantischer Abruf",
        "stepDecrease": "Verringern",
        "stepIncrease": "Erhöhen",
        "storage": "Speicherort",
        "stressWindow": "Druck / Fenster",
        "subSuffix": "Sitzung schreibgeschützt · Governance schreibbar",
        "supersede": "Ersetzen",
        "supersedePrompt": "Neuer Inhalt (Original nicht vollständig gezeigt; vollständigen Text einfügen):",
        "supersedeTitle": "Durch neuen Inhalt ersetzen",
        "switchToHub": "zu hub wechseln",
        "switchToNative": "zu native wechseln",
        "tabConfig": "Konfiguration",
        "tabLocale": "Sprache",
        "tabMemory": "Speicher",
        "tabObserve": "Beobachtung",
        "tabOverview": "Übersicht",
        "tabsAria": "Panel-Bereiche",
        "thActions": "Aktionen",
        "thConfidence": "Konf.",
        "thCount": "Anzahl",
        "thDistribution": "Verteilung",
        "thEstimate": "Geschätzt",
        "thEvent": "Ereignis",
        "thFolded": "Gefaltet",
        "thInjected": "Injiziert",
        "thKind": "Typ",
        "thMetric": "Kennzahl",
        "thModel": "Modell",
        "thPurpose": "Zweck",
        "thRange": "Bereich",
        "thReask": "Rückfrage",
        "thSaved": "Gespart",
        "thScope": "Umfang",
        "thSegment": "Segment",
        "thShare": "Anteil",
        "thSummary": "Zusammenfassung",
        "thText": "Inhalt",
        "thUses": "Nutzungen",
        "thValue": "Wert",
        "timeoutRate": "Timeout-Rate",
        "totalLabel": "Gesamt",
        "totalTokens": "Geschätzte Tokens gesamt",
        "ttlGlobal": "global",
        "ttlGroup": "Erinnerungs-TTL",
        "ttlNever": "nie",
        "ttlPermanent": "dauerhaft",
        "ttlProject": "project",
        "ttlSession": "session",
        "unknown": "—",
        "unknownError": "unbekannter Fehler",
        "unlimited": "unbegrenzt",
        "updatedAt": "aktualisiert {0}",
        "useThisLang": "Diese Sprache verwenden",
        "vectorHint": "Zuerst embedding.baseUrl/model im Profil konfigurieren",
        "vectorRecall": "Vektor-Abruf",
        "watermarkAriaOff": "Wasserstand-Komprimierung ausschalten",
        "watermarkAriaOn": "Wasserstand-Komprimierung einschalten",
        "watermarkHint": "Im Speicher gesichert; komprimiert wird weiterhin über natives compactRegion",
        "watermarkOff": "aus",
        "watermarkOn": "ein",
        "watermarkTitle": "Wasserstand: {0}",
        "yes": "Ja",
        "autoDetectDesc": "Systemsprache folgen"
      },
      "fr": {
        "activeExtra": "{0} actives · {1} en attente",
        "activeMemories": "mémoires actives",
        "activity.abtest": "Compression A/B",
        "activity.compact": "Compresser",
        "activity.compact-hub": "Compression hub",
        "activity.compact-hub-fallback": "Repli compression hub",
        "activity.embedding-ready": "Embedding prêt",
        "activity.embedding-reset": "Embedding réinitialisé",
        "activity.embedding-start": "Démarrage embedding",
        "activity.embedding-start-error": "Échec démarrage embedding",
        "activity.extract": "Extraire",
        "activity.forget": "Oublier",
        "activity.locale-change": "Langue changée",
        "activity.probe": "Sonde",
        "activity.recall": "Rappel",
        "activity.recall-miss": "Rappel sans résultat",
        "activity.reembed": "Recalculer l'embedding",
        "activity.request": "Requête",
        "activity.rerank": "Réordonner",
        "activity.rerank-empty": "Réordonnancement vide",
        "activity.rerank-error": "Échec réordonnancement",
        "activity.restore": "Restaurer le texte",
        "activity.review-approve": "Révision approuvée",
        "activity.review-reject": "Révision rejetée",
        "activity.rewrite": "Réécrire",
        "activity.rewrite-empty": "Réécriture vide",
        "activity.rewrite-error": "Échec réécriture",
        "activity.rewrite-retry": "Nouvelle réécriture",
        "activity.summary": "Résumé",
        "activity.supersede": "Remplacer",
        "activity.watermark": "Compression au fil de l'eau",
        "activity.watermark-error": "Échec compression",
        "activity.watermark-toggle": "Bascule compression",
        "approve": "Approuver",
        "autoDetect": "Détection automatique",
        "avgLatency": "Latence moy.",
        "avgPeak": "moy. {0} · pic {1}",
        "avgShare": "moy. {0} · {1}% du total",
        "byScope": "Par portée",
        "byType": "Par type",
        "cacheHit": "cache touché · entrée {0} / lecture cache {1} / sortie {2}",
        "capCompact": "Compression",
        "capMode": "Mode",
        "capRerank": "Réordonnancement",
        "capRewrite": "Réécriture",
        "capSearch": "Recherche",
        "capVectorFusion": "vecteur · {0}",
        "capWatermark": "Compression",
        "charsLabel": "{0} caractères",
        "close": "Fermer (Échap)",
        "collapseRecent": "Replier les récents",
        "compactTakeover": "Compression et reprise",
        "compactorHint": "hub remplace seulement le prompt de résumé, retour arrière en cas d'échec",
        "compactorHubValue": "hub · 8 sections",
        "compactorTitle": "Compresseur : {0}",
        "conflictPolicy": "Politique de conflit",
        "ctxCompression": "Taux de compression",
        "ctxPressure": "Pression du contexte",
        "ctxTokens": "Jetons utilisés",
        "ctxTurns": "Tours de conversation",
        "dataUnavailable": "Données indisponibles : {0}",
        "dayUnit": "{0} jours",
        "days": "jours",
        "dbUnavailable": "Mémoire indisponible : {0}",
        "disable": "désactiver",
        "emptyMemories": "Le stockage est vide : l'extraction se fait en fin de tour, ou utilisez context_hub_remember.",
        "enable": "activer",
        "expandRecent": "Déplier les récents",
        "extractGroup": "Extraction et conflit",
        "extractPasses": "Extractions/tour",
        "foldCount": "Replis",
        "foldLast": "Dernière plage",
        "foldReask": "Taux de redemande",
        "foldReask2": "Redemande",
        "foldRegion": "Plage",
        "foldSaved": "Total économisé",
        "foldSaved2": "Économisé",
        "foldShadowed": "Replié",
        "foldSummary": "Résumé",
        "foldedLabel": "Replié",
        "foldedValue": "{0} plages · {1} jetons",
        "footerNote": "Données issues du tokenMeter hôte, de la mémoire et du journal de session",
        "forget": "Oublier",
        "forgetTitle": "Oublier (suppression douce, chaîne d'audit conservée)",
        "goReview": "Réviser →",
        "graphEmpty": "Graphe : aucune entité (extraites à l'écriture des mémoires)",
        "graphInfo": "Graphe : {0} entités / {1} liens (1 saut, max. 2 au rappel)",
        "hitRate": "Taux de succès",
        "injectLabel": "Injecté (context-hub)",
        "injectedTokens": "Jetons injectés",
        "itemsCount": "{0} éléments",
        "itemsLabel": "{0} éléments",
        "kind.decision": "Décision",
        "kind.fact": "Fait",
        "kind.preference": "Préférence",
        "kind.skill": "Compétence",
        "kind.summary": "Résumé",
        "kind.task": "Tâche",
        "kwFts": "mots-clés + FTS5",
        "langEnabled": "Actif",
        "linksCount": "{0} liens",
        "llmRerank": "Réordonnancement LLM",
        "loading": "Chargement…",
        "loadingDots": "Chargement…",
        "localeCommand": "Commande :",
        "localeCurrent": "Réglage actuel",
        "localeCurrentLang": "Langue actuelle :",
        "localeHint": "Le panneau et les sorties de commande changent immédiatement. Le réglage est conservé.",
        "localeTitle": "🌐 Réglages de langue",
        "memActive": "Actives",
        "memArchived": "Archivées",
        "memGlobal": "Globales",
        "memMessages": "Index des messages",
        "memPending": "En attente",
        "memProject": "Projet",
        "memSession": "Session",
        "memSuperseded": "Remplacées",
        "memTotal": "Total",
        "modeTitle": "Mode : {0}",
        "msLabel": "{0} ms",
        "no": "Non",
        "noComposition": "Aucune donnée de composition.",
        "noSamples": "Aucun échantillon",
        "noSession": "Aucune session ouverte ; seule la mémoire est affichée.",
        "noSessionObs": "Aucune session ouverte ; pas d'observations de contexte.",
        "nodesEvents": "Nœuds / événements",
        "off": "désactivé",
        "on": "activé",
        "opFailed": "Échec de l'opération : {0}",
        "outputReserve": "Réserve de sortie",
        "panelSubReadonly": "Vue en lecture seule de la mémoire et de la compression",
        "panelSubSession": "Session {0}…",
        "panelTitle": "Context Hub",
        "partsAria": "Composition du contexte",
        "pendingBadge": "{0} en attente",
        "pendingCallout": "{0} mémoires à réviser",
        "pillContext": "Contexte {0}",
        "pillLoading": "Context Hub · chargement…",
        "pillMemory": "· mémoire {0}",
        "pillTitle": "Ouvrir le panneau Context Hub",
        "pillTitlePending": "Ouvrir le panneau Context Hub ({0} en attente)",
        "pillUnavailable": "Context Hub · indisponible",
        "policyEvidence": "Preuve la plus récente",
        "policyRecency": "Priorité au temps",
        "pressure": "Pression",
        "queryRewrite": "Réécriture de requête",
        "recallBudget": "Budget de rappel",
        "recallChars": "Caractères",
        "recallCooldown": "Délai de refroidissement",
        "recallItems": "Éléments",
        "recallLane": "Dernière voie de rappel : {0} · {1} éléments · {2} caractères · {3} messages sources",
        "recallTimeout": "Délai de rappel",
        "recallTokens": "Plafond de jetons",
        "recentUses": "Utilisés récemment",
        "refresh": "Rafraîchir",
        "refreshedNote": "{0} · actualisé toutes les 10 s quand ouvert",
        "reject": "Rejeter",
        "rerankHint": "Réordonner 10 candidats par pertinence ; retour à l'ordre initial en cas d'échec",
        "reviewHint": "Les extractions peu fiables passent d'abord en attente et ne sont rappelées qu'après approbation.",
        "rewriteHint": "Un appel LLM étend la requête en synonymes/mots-clés anglais",
        "scope.global": "Global",
        "scope.project": "Projet",
        "scope.session": "Session",
        "sectionActivity": "Activité",
        "sectionActivityCount": "{0} types d'événements",
        "sectionActivityTop": "Top 5 / {0} types",
        "sectionConfig": "Configuration",
        "sectionContext": "Composition du contexte",
        "sectionCost": "Courbe de coût",
        "sectionDetail": "Détail du contexte",
        "sectionEvents": "Événements",
        "sectionExtract": "Extraction et conflit",
        "sectionKinds": "Types de mémoire",
        "sectionLedger": "Journal de compression",
        "sectionMemory": "Mémoire",
        "sectionPartsExtra": "system / tools non séparés",
        "sectionPending": "En attente de révision",
        "sectionPendingExtra": "{0} éléments",
        "sectionReadonly": "Lecture seule · ne remplace pas la compression native",
        "sectionRecall": "Budget de rappel",
        "sectionRecent": "Mémoires récentes",
        "sectionRequests": "Échantillons de requêtes",
        "sectionRequestsExtra": "{0} échantillons",
        "sectionReview": "Révision",
        "sectionScopes": "Portées de mémoire",
        "sectionSeriesExtra": "{0} dernières requêtes · plus ancien à gauche",
        "sectionTtl": "TTL des mémoires",
        "sectionUsage": "Statistiques d'usage",
        "seg.assistant": "Assistant",
        "seg.injected": "Injecté",
        "seg.other": "Autre",
        "seg.summary": "Résumé",
        "seg.tool": "Outil",
        "seg.user": "Utilisateur",
        "semanticRecall": "Rappel sémantique",
        "stepDecrease": "Diminuer",
        "stepIncrease": "Augmenter",
        "storage": "Stockage",
        "stressWindow": "Pression / fenêtre",
        "subSuffix": "session en lecture seule · gouvernance modifiable",
        "supersede": "Remplacer",
        "supersedePrompt": "Nouveau contenu (l'original n'est pas affiché en entier ; collez le texte complet) :",
        "supersedeTitle": "Remplacer par un nouveau contenu",
        "switchToHub": "passer à hub",
        "switchToNative": "passer à native",
        "tabConfig": "Config",
        "tabLocale": "Langue",
        "tabMemory": "Mémoire",
        "tabObserve": "Observation",
        "tabOverview": "Aperçu",
        "tabsAria": "Sections du panneau",
        "thActions": "Actions",
        "thConfidence": "Conf.",
        "thCount": "Fois",
        "thDistribution": "Répartition",
        "thEstimate": "Est.",
        "thEvent": "Événement",
        "thFolded": "Replié",
        "thInjected": "Injecté",
        "thKind": "Type",
        "thMetric": "Indicateur",
        "thModel": "Modèle",
        "thPurpose": "Usage",
        "thRange": "Plage",
        "thReask": "Redemande",
        "thSaved": "Économisé",
        "thScope": "Portée",
        "thSegment": "Segment",
        "thShare": "Part",
        "thSummary": "Résumé",
        "thText": "Contenu",
        "thUses": "Utilisations",
        "thValue": "Valeur",
        "timeoutRate": "Taux de délai dépassé",
        "totalLabel": "Total",
        "totalTokens": "Jetons estimés au total",
        "ttlGlobal": "global",
        "ttlGroup": "TTL des mémoires",
        "ttlNever": "jamais",
        "ttlPermanent": "permanent",
        "ttlProject": "projet",
        "ttlSession": "session",
        "unknown": "—",
        "unknownError": "erreur inconnue",
        "unlimited": "illimité",
        "updatedAt": "actualisé {0}",
        "useThisLang": "Utiliser cette langue",
        "vectorHint": "Configurez d'abord embedding.baseUrl/model dans le profil",
        "vectorRecall": "Rappel vectoriel",
        "watermarkAriaOff": "Désactiver la compression au fil de l'eau",
        "watermarkAriaOn": "Activer la compression au fil de l'eau",
        "watermarkHint": "Conservé en mémoire ; la compression reste assurée par le compactRegion natif",
        "watermarkOff": "désactivé",
        "watermarkOn": "activé",
        "watermarkTitle": "Compression : {0}",
        "yes": "Oui",
        "autoDetectDesc": "suivre la langue du système"
      },
      "es": {
        "activeExtra": "{0} activas · {1} pendientes",
        "activeMemories": "memorias activas",
        "activity.abtest": "Compresión A/B",
        "activity.compact": "Comprimir",
        "activity.compact-hub": "Compresión hub",
        "activity.compact-hub-fallback": "Repliegue compresión hub",
        "activity.embedding-ready": "Embedding listo",
        "activity.embedding-reset": "Embedding reiniciado",
        "activity.embedding-start": "Iniciando embedding",
        "activity.embedding-start-error": "Fallo al iniciar embedding",
        "activity.extract": "Extraer",
        "activity.forget": "Olvidar",
        "activity.locale-change": "Idioma cambiado",
        "activity.probe": "Sonda",
        "activity.recall": "Recuperación",
        "activity.recall-miss": "Recuperación sin resultados",
        "activity.reembed": "Recalcular embedding",
        "activity.request": "Solicitud",
        "activity.rerank": "Reordenar",
        "activity.rerank-empty": "Reorden vacío",
        "activity.rerank-error": "Fallo al reordenar",
        "activity.restore": "Restaurar texto",
        "activity.review-approve": "Revisión aprobada",
        "activity.review-reject": "Revisión rechazada",
        "activity.rewrite": "Reescribir",
        "activity.rewrite-empty": "Reescritura vacía",
        "activity.rewrite-error": "Fallo al reescribir",
        "activity.rewrite-retry": "Reintento de reescritura",
        "activity.summary": "Resumen",
        "activity.supersede": "Reemplazar",
        "activity.watermark": "Compresión por marca de agua",
        "activity.watermark-error": "Fallo de marca de agua",
        "activity.watermark-toggle": "Alternar marca de agua",
        "approve": "Aprobar",
        "autoDetect": "Detección automática",
        "avgLatency": "Latencia media",
        "avgPeak": "media {0} · pico {1}",
        "avgShare": "media {0} · {1}% del total",
        "byScope": "Por ámbito",
        "byType": "Por tipo",
        "cacheHit": "acierto de caché · entrada {0} / lectura {1} / salida {2}",
        "capCompact": "Compresión",
        "capMode": "Modo",
        "capRerank": "Reorden",
        "capRewrite": "Reescritura",
        "capSearch": "Búsqueda",
        "capVectorFusion": "vector · {0}",
        "capWatermark": "Marca de agua",
        "charsLabel": "{0} caracteres",
        "close": "Cerrar (Esc)",
        "collapseRecent": "Contraer recientes",
        "compactTakeover": "Compresión y toma de control",
        "compactorHint": "hub solo cambia el prompt de resumen; si falla vuelve atrás",
        "compactorHubValue": "hub · 8 secciones",
        "compactorTitle": "Compresor: {0}",
        "conflictPolicy": "Política de conflicto",
        "ctxCompression": "Tasa de compresión",
        "ctxPressure": "Presión de contexto",
        "ctxTokens": "Tokens usados",
        "ctxTurns": "Turnos de conversación",
        "dataUnavailable": "Datos no disponibles: {0}",
        "dayUnit": "{0} días",
        "days": "días",
        "dbUnavailable": "Memoria no disponible: {0}",
        "disable": "desactivar",
        "emptyMemories": "La memoria está vacía: la extracción ocurre al final del turno, o usa context_hub_remember.",
        "enable": "activar",
        "expandRecent": "Expandir recientes",
        "extractGroup": "Extracción y conflicto",
        "extractPasses": "Extracciones/turno",
        "foldCount": "Pliegues",
        "foldLast": "Último rango",
        "foldReask": "Tasa de repregunta",
        "foldReask2": "Repregunta",
        "foldRegion": "Rango",
        "foldSaved": "Total ahorrado",
        "foldSaved2": "Ahorrado",
        "foldShadowed": "Plegado",
        "foldSummary": "Resumen",
        "foldedLabel": "Plegado",
        "foldedValue": "{0} rangos · {1} tokens",
        "footerNote": "Datos del tokenMeter del host, la memoria y el registro de sesión",
        "forget": "Olvidar",
        "forgetTitle": "Olvidar (borrado suave, se conserva la auditoría)",
        "goReview": "Revisar →",
        "graphEmpty": "Grafo: aún sin entidades (se extraen al escribir memorias)",
        "graphInfo": "Grafo: {0} entidades / {1} enlaces (1 salto, máx. 2 al recuperar)",
        "hitRate": "Tasa de acierto",
        "injectLabel": "Inyectado (context-hub)",
        "injectedTokens": "Tokens inyectados",
        "itemsCount": "{0} elementos",
        "itemsLabel": "{0} elementos",
        "kind.decision": "Decisión",
        "kind.fact": "Hecho",
        "kind.preference": "Preferencia",
        "kind.skill": "Habilidad",
        "kind.summary": "Resumen",
        "kind.task": "Tarea",
        "kwFts": "palabras clave + FTS5",
        "langEnabled": "Activo",
        "linksCount": "{0} enlaces",
        "llmRerank": "Reorden LLM",
        "loading": "Cargando…",
        "loadingDots": "Cargando…",
        "localeCommand": "Comando:",
        "localeCurrent": "Configuración actual",
        "localeCurrentLang": "Idioma actual:",
        "localeHint": "El panel y la salida de comandos cambian al instante. La preferencia se guarda.",
        "localeTitle": "🌐 Configuración de idioma",
        "memActive": "Activas",
        "memArchived": "Archivadas",
        "memGlobal": "Globales",
        "memMessages": "Índice de mensajes",
        "memPending": "Pendientes",
        "memProject": "Proyecto",
        "memSession": "Sesión",
        "memSuperseded": "Reemplazadas",
        "memTotal": "Total",
        "modeTitle": "Modo: {0}",
        "msLabel": "{0} ms",
        "no": "No",
        "noComposition": "Sin datos de composición.",
        "noSamples": "Sin muestras",
        "noSession": "No hay sesión abierta; solo se muestra la memoria.",
        "noSessionObs": "No hay sesión abierta; sin datos de observación del contexto.",
        "nodesEvents": "Nodos / eventos",
        "off": "desactivado",
        "on": "activado",
        "opFailed": "Operación fallida: {0}",
        "outputReserve": "Reserva de salida",
        "panelSubReadonly": "Vista de solo lectura de memoria y compresión",
        "panelSubSession": "Sesión {0}…",
        "panelTitle": "Context Hub",
        "partsAria": "Composición del contexto",
        "pendingBadge": "{0} pendientes",
        "pendingCallout": "{0} memorias pendientes de revisión",
        "pillContext": "Contexto {0}",
        "pillLoading": "Context Hub · cargando…",
        "pillMemory": "· memoria {0}",
        "pillTitle": "Abrir el panel de Context Hub",
        "pillTitlePending": "Abrir el panel de Context Hub ({0} pendientes)",
        "pillUnavailable": "Context Hub · no disponible",
        "policyEvidence": "Gana la evidencia nueva",
        "policyRecency": "Gana lo más reciente",
        "pressure": "Presión",
        "queryRewrite": "Reescritura de consulta",
        "recallBudget": "Presupuesto de recuperación",
        "recallChars": "Caracteres",
        "recallCooldown": "Enfriamiento",
        "recallItems": "Elementos",
        "recallLane": "Última vía de recuperación: {0} · {1} elementos · {2} caracteres · {3} mensajes origen",
        "recallTimeout": "Tiempo límite",
        "recallTokens": "Tope de tokens",
        "recentUses": "Usadas recientemente",
        "refresh": "Actualizar",
        "refreshedNote": "{0} · se actualiza cada 10 s mientras está abierto",
        "reject": "Rechazar",
        "rerankHint": "Reordena 10 candidatos por relevancia; si falla mantiene el orden original",
        "reviewHint": "Las extracciones de baja confianza van primero a pendientes y solo se recuperan tras aprobarse.",
        "rewriteHint": "Una llamada al LLM amplía la consulta con sinónimos/palabras en inglés",
        "scope.global": "Global",
        "scope.project": "Proyecto",
        "scope.session": "Sesión",
        "sectionActivity": "Actividad",
        "sectionActivityCount": "{0} tipos de eventos",
        "sectionActivityTop": "Top 5 / {0} tipos",
        "sectionConfig": "Configuración",
        "sectionContext": "Composición del contexto",
        "sectionCost": "Curva de coste",
        "sectionDetail": "Detalle del contexto",
        "sectionEvents": "Eventos",
        "sectionExtract": "Extracción y conflicto",
        "sectionKinds": "Tipos de memoria",
        "sectionLedger": "Registro de compresión",
        "sectionMemory": "Memoria",
        "sectionPartsExtra": "system / tools sin separar",
        "sectionPending": "Pendiente de revisión",
        "sectionPendingExtra": "{0} elementos",
        "sectionReadonly": "Solo lectura · no sustituye la compresión nativa",
        "sectionRecall": "Presupuesto de recuperación",
        "sectionRecent": "Memorias recientes",
        "sectionRequests": "Muestras de solicitudes",
        "sectionRequestsExtra": "{0} muestras",
        "sectionReview": "Revisión",
        "sectionScopes": "Ámbitos de memoria",
        "sectionSeriesExtra": "últimas {0} solicitudes · más antiguo a la izquierda",
        "sectionTtl": "TTL de memoria",
        "sectionUsage": "Estadísticas de uso",
        "seg.assistant": "Asistente",
        "seg.injected": "Inyectado",
        "seg.other": "Otro",
        "seg.summary": "Resumen",
        "seg.tool": "Herramienta",
        "seg.user": "Usuario",
        "semanticRecall": "Recuperación semántica",
        "stepDecrease": "Disminuir",
        "stepIncrease": "Aumentar",
        "storage": "Almacenamiento",
        "stressWindow": "Presión / ventana",
        "subSuffix": "sesión de solo lectura · gobernanza editable",
        "supersede": "Reemplazar",
        "supersedePrompt": "Contenido nuevo (el original no se muestra completo; pega el texto entero):",
        "supersedeTitle": "Reemplazar con contenido nuevo",
        "switchToHub": "cambiar a hub",
        "switchToNative": "cambiar a native",
        "tabConfig": "Config",
        "tabLocale": "Idioma",
        "tabMemory": "Memoria",
        "tabObserve": "Observación",
        "tabOverview": "Resumen",
        "tabsAria": "Secciones del panel",
        "thActions": "Acciones",
        "thConfidence": "Conf.",
        "thCount": "Veces",
        "thDistribution": "Distribución",
        "thEstimate": "Est.",
        "thEvent": "Evento",
        "thFolded": "Plegado",
        "thInjected": "Inyectado",
        "thKind": "Tipo",
        "thMetric": "Métrica",
        "thModel": "Modelo",
        "thPurpose": "Uso",
        "thRange": "Rango",
        "thReask": "Repregunta",
        "thSaved": "Ahorrado",
        "thScope": "Ámbito",
        "thSegment": "Segmento",
        "thShare": "Cuota",
        "thSummary": "Resumen",
        "thText": "Contenido",
        "thUses": "Usos",
        "thValue": "Valor",
        "timeoutRate": "Tasa de tiempo agotado",
        "totalLabel": "Total",
        "totalTokens": "Tokens estimados totales",
        "ttlGlobal": "global",
        "ttlGroup": "TTL de memoria",
        "ttlNever": "nunca",
        "ttlPermanent": "permanente",
        "ttlProject": "proyecto",
        "ttlSession": "sesión",
        "unknown": "—",
        "unknownError": "error desconocido",
        "unlimited": "ilimitado",
        "updatedAt": "actualizado {0}",
        "useThisLang": "Usar este idioma",
        "vectorHint": "Configura primero embedding.baseUrl/model en el perfil",
        "vectorRecall": "Recuperación vectorial",
        "watermarkAriaOff": "Desactivar compresión por marca de agua",
        "watermarkAriaOn": "Activar compresión por marca de agua",
        "watermarkHint": "Se guarda en la memoria; la compresión sigue a cargo del compactRegion nativo",
        "watermarkOff": "desactivado",
        "watermarkOn": "activado",
        "watermarkTitle": "Marca de agua: {0}",
        "yes": "Sí",
        "autoDetectDesc": "seguir el idioma del sistema"
      }
    }
    /* i18n:extra-more:end */

    // 子组件可用的模块级语言：Panel 渲染前写入，子组件渲染时读取
    let panelLocale = 'zh'
    const tr = (key, ...args) => tPanel(panelLocale, key, ...args)
    const activityLabel = (kind) => {
      const v = tr(`activity.${kind}`)
      return v === `activity.${kind}` ? String(kind) : v
    }
    const kindLabel = (kind) => {
      const v = tr(`kind.${kind}`)
      return v === `kind.${kind}` ? String(kind) : v
    }
    const scopeLabel = (scope) => {
      const v = tr(`scope.${scope}`)
      return v === `scope.${scope}` ? String(scope) : v
    }
    /** 浏览器端跟随系统语言：navigator.language → 支持的语言码。 */
    function detectUiLocale() {
      try {
        const raw = String((typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) || '')
        const base = raw.split('-')[0].toLowerCase()
        if (['zh', 'ja', 'en', 'ko', 'de', 'fr', 'es'].includes(base)) return base
      } catch { /* navigator 不可用时回退中文 */ }
      return 'zh'
    }
    /** 面板语言偏好：localStorage 优先，让切换立即生效、不必等服务端重启。 */
    const LOCALE_KEY = 'context-hub.locale'
    function readStoredLocale() {
      try {
        const raw = localStorage.getItem(LOCALE_KEY)
        if (typeof raw === 'string' && raw.length > 0) return raw
      } catch { /* 隐私模式/禁用存储时忽略 */ }
      return 'auto'
    }
    function storeLocale(code) {
      try { localStorage.setItem(LOCALE_KEY, String(code)) } catch { /* 忽略 */ }
    }
    /** 计算最终生效的面板语言。 */
    function effectiveLocale(preferred) {
      if (preferred === undefined || preferred === null || preferred === 'auto' || preferred === '') return detectUiLocale()
      return String(preferred)
    }


    const SEGMENTS = [
      { key: 'user', color: 'var(--dsw-alias-state-business-primary, #3b82f6)' },
      { key: 'assistant', color: '#8b5cf6' },
      { key: 'tool', color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' },
      { key: 'injected', color: 'var(--dsw-alias-state-success-primary, #10b981)' },
      { key: 'summary', color: '#06b6d4' },
      { key: 'other', color: 'var(--dsw-alias-label-dimmed, #94a3b8)' },
    ]

    const KIND_COLORS = {
      decision: '#6366f1',
      fact: '#0ea5e9',
      preference: '#f59e0b',
      task: '#10b981',
      skill: '#a855f7',
      summary: '#64748b',
    }
    const KIND_VALUES = ['decision', 'fact', 'preference', 'task', 'skill', 'summary']
    const SCOPES = [
      { key: 'session', color: '#3b82f6' },
      { key: 'project', color: '#8b5cf6' },
      { key: 'global', color: '#10b981' },
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
        background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-state-business-primary,#2563eb) 7%,var(--dsw-alias-card-fill,#f8fafc)),var(--dsw-alias-card-fill,var(--dsw-alias-bg-layer-2,#f8fafc)) 55%);
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-ring{flex:none;display:grid;place-items:center;position:relative;width:78px;height:78px}
      .chp-ring svg{transform:rotate(-90deg)}
      .chp-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
      .chp-ring-num{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
      .chp-ring-cap{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-stats{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px;min-width:0}
      .chp-stat{min-width:0}
      .chp-stat-k{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);white-space:nowrap}
      .chp-stat-i{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:5px;flex:none}
      .chp-duo{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
      .chp-donut{position:relative;width:max-content;margin:2px auto 0}
      .chp-donut-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;pointer-events:none}
      .chp-donut-v{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.05}
      .chp-donut-k{font-size:9.5px;color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-legend{display:flex;flex-direction:column;gap:4px;margin-top:8px}
      .chp-legend-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#475569)}
      .chp-legend-row b{margin-left:auto;font-weight:650;color:var(--dsw-alias-label-primary,#0f172a);font-variant-numeric:tabular-nums}
      .chp-legend-pct{width:36px;text-align:right;font-size:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);font-variant-numeric:tabular-nums}
      .chp-cache{display:flex;align-items:center;gap:10px;margin-top:9px;padding:8px 10px;border-radius:10px;
        background:var(--dsw-alias-card-fill,var(--dsw-alias-bg-layer-2,#f8fafc));
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-cache-v{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
      .chp-chips{display:flex;flex-wrap:wrap;gap:5px}
      .chp-chip-cap{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:8px;font-size:10.5px;
        color:var(--dsw-alias-label-secondary,#475569);background:var(--dsw-alias-bg-layer-2,rgba(15,23,42,.04));
        border:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.07))}
      .chp-chip-cap-k{color:var(--dsw-alias-label-tertiary,#94a3b8)}
      .chp-chip-cap-v{font-weight:650;color:var(--dsw-alias-label-primary,#0f172a)}
      .chp-cache-k{font-size:10.5px;color:var(--dsw-alias-label-secondary,#475569)}
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
      .chp-editgroup{margin:8px 0 2px}
      .chp-editgroup-title{font-size:11px;color:var(--dsw-alias-label-tertiary,#94a3b8);letter-spacing:.04em;margin:8px 0 2px}
      .chp-editrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-editrow:last-child{border-bottom:0}
      .chp-editlabel{font-size:12px;color:var(--dsw-alias-label-secondary,#475569)}
      .chp-editrow-hint{display:block;font-size:10px;color:var(--dsw-alias-label-tertiary,#94a3b8);margin-top:1px}
      .chp-editvalue{display:flex;align-items:center;gap:6px}
      .chp-step{display:inline-flex;align-items:center;gap:4px}
      .chp-step-btn{width:20px;height:20px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#475569);font-size:12px;line-height:1;cursor:pointer;padding:0}
      .chp-step-btn:disabled{opacity:.4;cursor:default}
      .chp-step-v{min-width:60px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#0f172a)}
      .chp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));border-radius:8px;overflow:hidden}
      .chp-seg-btn{border:0;background:transparent;padding:3px 8px;font-size:11px;color:var(--dsw-alias-label-secondary,#475569);cursor:pointer}
      .chp-seg-btn+.chp-seg-btn{border-left:1px solid var(--dsw-alias-border-l1,rgba(15,23,42,.08))}
      .chp-seg-on{background:var(--dsw-alias-card-fill-hover,#eef2ff);color:var(--dsw-alias-state-business-primary,#2563eb);font-weight:600}
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
      .chp-pill{display:inline-flex;align-items:center;gap:7px;margin:2px auto 6px 0;padding:3px 10px 3px 5px;
        border-radius:999px;cursor:pointer;font-family:inherit;font-size:12px;line-height:16px;
        color:var(--dsw-alias-label-secondary,#475569);
        background:var(--dsw-alias-bg-layer-1,#fff);
        border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));
        box-shadow:0 1px 2px rgba(2,6,23,.05);transition:color .12s,border-color .12s,background .12s}
      .chp-pill:hover{color:var(--dsw-alias-label-primary,#0f172a);
        border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#2563eb) 45%,transparent);
        background:var(--dsw-alias-interactive-bg-hover,rgba(15,23,42,.04))}
      .chp-chip{gap:5px;margin:0;padding:3px 8px 3px 4px;font-size:11px;border-radius:9px}
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

    const GLYPHS = {
      layers: ['M12 3 3 8l9 5 9-5-9-5Z', 'M3 13l9 5 9-5'],
      sum: ['M4 7c0-2 3-3 8-3s8 1 8 3-3 3-8 3-8 1-8 3 3 3 8 3 8-1 8-3', 'M12 6v12'],
      grid: ['M4 4h7v7H4Z', 'M13 4h7v7h-7Z', 'M4 13h7v7H4Z', 'M13 13h7v7h-7Z'],
      out: ['M7 17 17 7', 'M9 7h8v8'],
    }
    function Glyph(props) {
      const paths = GLYPHS[props.name] ?? []
      return h('svg', {
        width: props.size ?? 10, height: props.size ?? 10, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, paths.map((d, index) => h('path', { key: index, d })))
    }

    function Stat(props) {
      return h('div', { className: 'chp-stat' },
        h('div', { className: 'chp-stat-k' },
          props.icon === undefined ? null : h('span', {
            className: 'chp-stat-i',
            style: { color: props.color, background: `color-mix(in srgb, ${props.color} 13%, transparent)` },
          }, h(Glyph, { name: props.icon })),
          props.label),
        h('div', { className: 'chp-stat-v', title: props.title ?? undefined }, props.value))
    }

    function Donut(props) {
      const items = (props.items ?? []).filter(item => Number(item.value) > 0)
      const total = items.reduce((sum, item) => sum + Number(item.value), 0)
      const size = props.size ?? 118
      const width = props.width ?? 14
      const radius = (size - width) / 2
      const circumference = 2 * Math.PI * radius
      let consumed = 0
      const arcs = items.map((item, index) => {
        const length = (Number(item.value) / total) * circumference
        const gap = items.length > 1 ? 2 : 0
        const dash = Math.max(0, length - gap)
        const arc = h('circle', {
          key: item.key ?? index,
          cx: size / 2, cy: size / 2, r: radius, fill: 'none',
          stroke: item.color, strokeWidth: width,
          strokeDasharray: `${dash} ${circumference - dash}`,
          strokeDashoffset: -consumed,
          transform: `rotate(-90 ${size / 2} ${size / 2})`,
        })
        consumed += length
        return arc
      })
      return h('div', { className: 'chp-donut' },
        h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
          h('circle', {
            cx: size / 2, cy: size / 2, r: radius, fill: 'none',
            stroke: 'var(--dsw-alias-border-l2,rgba(15,23,42,.1))', strokeWidth: width,
          }),
          arcs),
        h('div', { className: 'chp-donut-c' },
          h('div', { className: 'chp-donut-v' }, props.center ?? fmt(total)),
          props.caption === undefined ? null : h('div', { className: 'chp-donut-k' }, props.caption)))
    }

    function Legend(props) {
      const items = props.items ?? []
      const total = items.reduce((sum, item) => sum + Number(item.value), 0) || 1
      return h('div', { className: 'chp-legend' }, items.map(item => h('div', { key: item.key, className: 'chp-legend-row' },
        h('span', { className: 'chp-dot', style: { background: item.color } }),
        h('span', null, item.label),
        h('b', null, String(item.value)),
        h('span', { className: 'chp-legend-pct' }, pctText(Number(item.value), total)))))
    }

    function StepControl(props) {
      const value = Number(props.value)
      const min = Number(props.min)
      const max = Number(props.max)
      const step = Number(props.step) || 1
      const disabled = props.disabled === true
      const clamp = n => Math.min(max, Math.max(min, n))
      const label = props.format ? props.format(value) : String(value)
      return h('span', { className: 'chp-step' },
        h('button', {
          type: 'button', className: 'chp-step-btn', 'aria-label': tr('stepDecrease'),
          disabled: disabled || value <= min,
          onClick: () => props.onChange(clamp(value - step)),
        }, '−'),
        h('span', { className: 'chp-step-v' }, label),
        h('button', {
          type: 'button', className: 'chp-step-btn', 'aria-label': tr('stepIncrease'),
          disabled: disabled || value >= max,
          onClick: () => props.onChange(clamp(value + step)),
        }, '+'))
    }

    function Segmented(props) {
      return h('span', { className: 'chp-seg' }, props.options.map(option => h('button', {
        key: String(option), type: 'button',
        className: `chp-seg-btn${option === props.value ? ' chp-seg-on' : ''}`,
        'aria-pressed': option === props.value,
        onClick: () => { if (option !== props.value) props.onChange(option) },
      }, props.format ? props.format(option) : String(option))))
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

    const ACTIVITY_COLORS = {
      recall: '#3b82f6', 'recall-miss': '#f59e0b', extract: '#8b5cf6', request: '#64748b',
      rerank: '#06b6d4', rewrite: '#10b981', probe: '#a855f7', compact: '#ef4444',
      'compact-hub': '#ef4444', unfold: '#0ea5e9', restore: '#14b8a6', reembed: '#eab308',
      'watermark': '#f97316', 'watermark-error': '#dc2626', 'review-approve': '#22c55e',
    }

    function Track(props) {
      const percent = Math.max(0, Math.min(100, Number.isFinite(props.percent) ? props.percent : 0))
      return h('span', { className: 'chp-track', title: props.title ?? undefined, 'aria-hidden': 'true' },
        h('span', { style: { width: `${percent}%`, background: props.color ?? 'var(--dsw-alias-state-business-primary,#2563eb)' } }))
    }

    function Sparkline(props) {
      const values = Array.isArray(props.values) ? props.values.map(value => Number(value) || 0) : []
      if (values.length === 0) return h('div', { className: 'chp-spark-empty' }, tr('noSamples'))
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
      const color = props.color
      return h('div', {
        className: 'chp-tile',
        title: props.title ?? undefined,
        style: color === undefined ? undefined : {
          borderColor: `color-mix(in srgb, ${color} 22%, transparent)`,
          background: `linear-gradient(160deg, color-mix(in srgb, ${color} 9%, var(--dsw-alias-card-fill,#f8fafc)), var(--dsw-alias-card-fill,#f8fafc))`,
        },
      },
        h('div', { className: 'chp-tile-k' }, props.label),
        h('div', { className: 'chp-tile-v', style: color === undefined ? undefined : { color } }, props.value))
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
      const items = SEGMENTS.map(segment => ({ ...segment, label: tr(`seg.${segment.key}`), value: Number(parts[segment.key] ?? 0) }))
      const total = items.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0)
      if (total <= 0) return h('div', { className: 'chp-empty' }, tr('noComposition'))
      const rows = items.filter(item => item.value > 0).map(item => h('tr', { key: item.key },
        h('td', null,
          h('span', { className: 'chp-dot', style: { background: item.color, marginRight: '7px' } }),
          item.label),
        h('td', { className: 'num' }, fmt(item.value)),
        h('td', { className: 'num', style: { color: item.color, fontWeight: 650 } }, pctText(item.value, total)),
        h('td', { style: { width: '26%' } }, h(Track, { percent: (item.value / total) * 100, color: item.color }))))
      return h('div', null,
        h('div', { className: 'chp-bar', 'aria-label': tr('partsAria') },
          items.filter(item => item.value > 0).map(item => h('div', {
            key: item.key,
            className: 'chp-seg',
            style: { width: `${(item.value / total) * 100}%`, background: item.color },
            title: `${item.label} ${fmt(item.value)}（${Math.round((item.value / total) * 100)}%）`,
          }))),
        h('table', { className: 'chp-table', style: { marginTop: '8px' } },
          h('thead', null, h('tr', null,
            h('th', null, tr('thSegment')),
            h('th', { className: 'num' }, 'tokens'),
            h('th', { className: 'num' }, tr('thShare')),
            h('th', { style: { width: '26%' } }, tr('thDistribution')))),
          h('tbody', null, rows)))
    }

    function MemoryTable(props) {
      const recent = props.memory.recent ?? []
      const onAction = props.onAction
      if (recent.length === 0) {
        return h('div', { className: 'chp-empty' }, tr('emptyMemories'))
      }
      return h('table', { className: 'chp-table' },
        h('thead', null, h('tr', null,
          h('th', { className: 'num' }, '#'),
          h('th', null, tr('thKind')),
          h('th', null, tr('thScope')),
          h('th', { className: 'num' }, tr('thConfidence')),
          h('th', { className: 'num' }, tr('thUses')),
          h('th', null, tr('thText')),
          h('th', null, tr('thActions')))),
        h('tbody', null, recent.map(item => h('tr', { key: item.id },
          h('td', { className: 'num chp-mono' }, `#${item.id}`),
          h('td', null, h(Badge, { kind: item.kind }, kindLabel(item.kind))),
          h('td', null, item.scope),
          h('td', { className: 'num' }, item.confidence === undefined ? '—' : String(item.confidence)),
          h('td', { className: 'num' }, String(item.uses ?? 0)),
          h('td', { className: 'chp-celltext', title: item.text }, item.text),
          h('td', null, h('div', { className: 'chp-rowactions' },
            h('button', {
              type: 'button', className: 'chp-mini-btn', title: tr('forgetTitle'),
              onClick: () => { if (onAction) onAction({ action: 'forget', id: item.id }) },
            }, tr('forget')),
            h('button', {
              type: 'button', className: 'chp-mini-btn', title: tr('supersedeTitle'),
              onClick: () => {
                const next = window.prompt(tr('supersedePrompt'), '')
                if (next && next.trim().length > 0 && onAction) onAction({ action: 'supersede', id: item.id, text: next.trim() })
              },
            }, tr('supersede'))))))))
    }

    function Tabs(props) {
      return h('div', { className: 'chp-tabs', role: 'tablist', 'aria-label': tr('tabsAria') },
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
      return h(Section, { title: tr('sectionPending'), extra: tr('sectionPendingExtra', items.length) },
        h('div', { className: 'chp-note', style: { marginBottom: '8px' } },
          tr('reviewHint')),
        h('div', { className: 'chp-review' }, items.map(row => h('div', { key: row.id, className: 'chp-review-row' },
          h('div', { className: 'chp-review-main' },
            h('div', { className: 'chp-mono chp-review-meta' }, `#${row.id} · ${row.kind}/${row.scope} · conf ${row.confidence}`),
            h('div', { className: 'chp-review-text' }, row.text)),
          h('div', { className: 'chp-review-actions' },
            h('button', {
              type: 'button', className: 'chp-mini-btn ok', title: tr('approve'),
              onClick: () => { if (onReview) onReview(row.id, 'approve') },
            }, '✓ ' + tr('approve')),
            h('button', {
              type: 'button', className: 'chp-mini-btn danger', title: tr('reject'),
              onClick: () => { if (onReview) onReview(row.id, 'reject') },
            }, '✕ ' + tr('reject')))))))
    }

    function Panel(props) {
      const { snapshot, failed, onRefresh, onClose, onToggleWatermark, onReview, onAction, uiLocale, onLocaleChange } = props
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

      // 面板文案语言：客户端偏好优先（切换即时生效），'auto' 时跟随系统
      const locale = effectiveLocale(uiLocale !== undefined && uiLocale !== null ? uiLocale : config.locale)
      panelLocale = locale   // 子组件（表格/图例/按钮）通过 tr() 读取
      const tp = (key, ...args) => tPanel(locale, key, ...args)

      const recentState = React.useState(true)
      const tabState = React.useState('overview')
      const recentExpanded = recentState[0]
      const setRecentExpanded = recentState[1]
      const tab = tabState[0]
      const setTab = tabState[1]

      const pendingItems = memory !== null && Array.isArray(memory.pendingItems) ? memory.pendingItems : []
      const tabs = [
        { key: 'overview', label: tp('tabOverview') },
        {
          key: 'memory',
          label: tp('tabMemory'),
          badge: memory === null ? undefined : String(memory.active),
          dot: pendingItems.length > 0,
          dotTitle: tp('pendingCallout', pendingItems.length),
        },
        { key: 'observe', label: tp('tabObserve') },
        { key: 'config', label: tp('tabConfig') },
        { key: 'locale', label: tp('tabLocale') },
      ]

      const sections = []
      if (snapshot === null) {
        sections.push(h('div', { key: 'loading', className: 'chp-empty' },
          failed === null ? tr('loadingDots') : tr('dataUnavailable', failed)))
      } else {
        if (failed !== null && failed !== undefined) {
          sections.push(h('p', { key: 'failed', className: 'chp-alert' }, tr('opFailed', failed)))
        }
        if (snapshot.openError !== null && snapshot.openError !== undefined) {
          sections.push(h('p', { key: 'warning', className: 'chp-alert' }, tr('dbUnavailable', snapshot.openError)))
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
              h('span', { className: 'chp-callout-text' }, tr('pendingCallout', pendingItems.length)),
              h('span', { className: 'chp-callout-go' }, tr('goReview'))))
          }
          if (session !== null && session !== undefined) {
            sections.push(h(Section, { key: 'parts', title: tp('sectionContext'), extra: tp('sectionPartsExtra') },
              h(Composition, { parts: session.parts })))
          }

          if (snapshot.ledger !== undefined && Number(snapshot.ledger.count) > 0) {
            const ledgerRows = [
              { key: 'count', label: tr('foldCount'), value: fmt(snapshot.ledger.count) },
              { key: 'saved', label: tr('foldSaved'), value: `${fmt(snapshot.ledger.saved)} tokens` },
              { key: 'reask', label: tr('foldReask'), value: `${Math.round(Number(snapshot.ledger.rate) * 100)}%` },
              { key: 'last', label: tr('foldLast'), value: snapshot.ledger.last ? `seq ${snapshot.ledger.last.start_seq}-${snapshot.ledger.last.end_seq}` : '—' },
            ]
            const recentLedger = Array.isArray(snapshot.ledger.recent) ? snapshot.ledger.recent : []
            sections.push(h(Section, { key: 'ledger', title: tp('sectionLedger'), extra: tp('sectionReadonly') },
              h('table', { className: 'chp-table' },
                h('tbody', null, ledgerRows.map(row => h('tr', { key: row.key },
                  h('td', null, row.label),
                  h('td', { className: 'num' }, row.value))))),
              recentLedger.length > 0
                ? h('table', { className: 'chp-table', style: { marginTop: '6px' } },
                    h('thead', null, h('tr', null,
                      h('th', null, tr('thRange')), h('th', { className: 'num' }, tr('thFolded')),
                      h('th', { className: 'num' }, tr('thSummary')), h('th', { className: 'num' }, tr('thSaved')),
                      h('th', null, tr('thReask')))),
                    h('tbody', null, recentLedger.map((row, index) => h('tr', { key: `${row.start_seq}-${row.end_seq}-${index}` },
                      h('td', { className: 'chp-mono' }, `seq ${row.start_seq}-${row.end_seq}`),
                      h('td', { className: 'num' }, fmt(row.shadowed_tokens)),
                      h('td', { className: 'num' }, fmt(row.summary_tokens)),
                      h('td', { className: 'num' }, fmt(row.saved_tokens)),
                      h('td', null, Number(row.reask) > 0 ? tr('yes') : '—')))))
                : null))
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
              usageLine = h('div', { className: 'chp-cache' },
                ring(cacheRate, 44, 5.5, 'var(--dsw-alias-state-success-primary,#10b981)'),
                h('div', null,
                  h('div', { className: 'chp-cache-v' }, `${cacheRate}%`),
                  h('div', { className: 'chp-cache-k' }, tr('cacheHit', fmt(input), fmt(cacheRead), fmt(output)))))
            }
            sections.push(h(Section, { key: 'cost', title: tp('sectionCost'), extra: tp('sectionSeriesExtra', series.length) },
              h('div', { className: 'chp-grid2' },
                h('div', null,
                  h('div', { className: 'chp-mini-title' }, tr('totalTokens')),
                  h(Sparkline, { values: totals }),
                  h('div', { className: 'chp-note' }, tr('avgPeak', fmt(totalAvg), fmt(Math.max(0, ...totals))))),
                h('div', null,
                  h('div', { className: 'chp-mini-title' }, tr('injectedTokens')),
                  h(Sparkline, { values: injections, color: 'var(--dsw-alias-state-success-primary,#10b981)' }),
                  h('div', { className: 'chp-note' }, tr('avgShare', fmt(injectAvg), (injectRatio < 10 ? injectRatio.toFixed(1) : Math.round(injectRatio)))))),
              usageLine))
          }

          if (activity.length > 0) {
            const top = [...activity].sort((a, b) => b.count - a.count).slice(0, 5)
            const max = Math.max(1, ...top.map(entry => entry.count))
            sections.push(h(Section, { key: 'activity-top', title: tp('sectionActivity'), extra: tp('sectionActivityTop', activity.length) },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, tr('thEvent')),
                  h('th', { className: 'num' }, tr('thCount')),
                  h('th', { style: { width: '36%' } }, tr('thDistribution')))),
                h('tbody', null, top.map(entry => h('tr', { key: entry.kind },
                  h('td', null, activityLabel(entry.kind)),
                  h('td', { className: 'num' }, String(entry.count)),
                  h('td', null, h(Track, {
                    percent: (entry.count / max) * 100,
                    color: ACTIVITY_COLORS[entry.kind] ?? 'var(--dsw-alias-state-business-primary,#2563eb)',
                  }))))))))
          }
        }

        if (tab === 'memory') {
          const memoryItems = [
            { key: 'active', label: tr('memActive'), value: fmt(memory.active) },
            { key: 'pending', label: tr('memPending'), value: fmt(memory.pending ?? 0) },
            { key: 'superseded', label: tr('memSuperseded'), value: fmt(memory.superseded) },
            { key: 'archived', label: tr('memArchived'), value: fmt(memory.archived) },
            { key: 'messages', label: tr('memMessages'), value: fmt(memory.messages ?? 0) },
          ]
          const scopeItems = SCOPES.map(scope => ({ ...scope, label: tr(`scope.${scope.key}`), value: Number(memory.scopes?.[scope.key] ?? 0) }))
          const kindItems = KIND_VALUES
            .filter(kind => kind !== 'summary')
            .map(kind => ({ key: kind, label: kindLabel(kind), color: KIND_COLORS[kind], value: Number(memory.kinds?.[kind] ?? 0) }))
          sections.push(h(Section, {
            key: 'memory',
            title: tp('sectionMemory'),
            extra: tr('activeExtra', fmt(memory.active), fmt(memory.pending ?? 0)),
          },
            h('div', { className: 'chp-tiles' }, memoryItems.map((item, index) => h(Tile, {
              key: item.key,
              label: item.label,
              value: item.value,
              color: ['#2563eb', '#f59e0b', '#8b5cf6', '#64748b', '#0ea5e9'][index],
            }))),
            h('div', { className: 'chp-duo' },
              h('div', null,
                h('div', { className: 'chp-mini-title' }, tr('byScope')),
                h(Bars, { items: scopeItems })),
              h('div', null,
                h('div', { className: 'chp-mini-title' }, tr('byType')),
                h(Donut, { items: kindItems, center: fmt(memory.active), caption: tr('activeMemories'), size: 118 }),
                h(Legend, { items: kindItems }))),
            h('div', { style: { marginTop: '12px' } },
              h('button', {
                type: 'button',
                className: 'chp-disclosure',
                'aria-expanded': recentExpanded ? 'true' : 'false',
                title: recentExpanded ? tr('collapseRecent') : tr('expandRecent'),
                onClick: () => { setRecentExpanded(!recentExpanded) },
              },
                h('span', { className: 'chp-tri', style: { transform: recentExpanded ? 'rotate(90deg)' : 'rotate(0deg)' } }),
                h('span', null, tr('recentUses')),
                h('span', { className: 'chp-mono', style: { fontWeight: 400, letterSpacing: 0 } }, tr('itemsCount', (memory.recent ?? []).length))),
              recentExpanded ? h('div', { style: { marginTop: '6px' } }, h(MemoryTable, { memory, onAction })) : null),
            h('div', { className: 'chp-note' },
              snapshot.graph !== undefined && Number(snapshot.graph.entities) > 0
                ? tr('graphInfo', fmt(snapshot.graph.entities), fmt(snapshot.graph.links))
                : tr('graphEmpty')),
            snapshot.graph !== undefined && Array.isArray(snapshot.graph.top) && snapshot.graph.top.length > 0
              ? h('div', { className: 'chp-chips', style: { marginTop: '4px' } },
                  snapshot.graph.top.map(item => h('span', { key: item.name, className: 'chp-chip-cap', title: tr('linksCount', item.count) },
                    `${item.name} ${fmt(item.count)}`)))
              : null,
            h('div', { className: 'chp-note' }, `${tr('storage')}: ${snapshot.db}`)))

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
                label: tr('stressWindow'),
                value: `${fmt(pressure)} / ${fmt(contextWindow)}`,
                percent: percent ?? 0,
                color: 'var(--dsw-alias-state-business-primary,#2563eb)',
              },
              {
                key: 'injected',
                label: tr('injectLabel'),
                value: `${fmt(injected)} tokens`,
                percent: session.surfaceTokens > 0 ? (injected / session.surfaceTokens) * 100 : 0,
                color: 'var(--dsw-alias-state-success-primary,#10b981)',
              },
              {
                key: 'reserve',
                label: tr('outputReserve'),
                value: `${fmt(session.outputReserve)} tokens`,
                percent: session.totalTokens > 0 ? (session.outputReserve / session.totalTokens) * 100 : 0,
                color: 'var(--dsw-alias-label-dimmed,#94a3b8)',
              },
              {
                key: 'folded',
                label: tr('foldedLabel'),
                value: tr('foldedValue', fmt(folded.count), fmt(folded.tokens)),
                percent: (folded.tokens + session.surfaceTokens) > 0
                  ? (folded.tokens / (folded.tokens + session.surfaceTokens)) * 100
                  : 0,
                color: '#8b5cf6',
              },
            ]
            sections.push(h(Section, { key: 'usage', title: tp('sectionDetail') },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, tr('thMetric')),
                  h('th', { className: 'num' }, tr('thValue')),
                  h('th', { style: { width: '30%' } }, tr('thShare')))),
                h('tbody', null, usageRows.map(row => h('tr', { key: row.key },
                  h('td', null, row.label),
                  h('td', { className: 'num' }, row.value),
                  h('td', null, h(Track, { percent: row.percent, color: row.color, title: `${row.percent.toFixed(1)}%` })))))))) 
          }

          if (activity.length > 0) {
            const sorted = [...activity].sort((a, b) => b.count - a.count)
            const max = Math.max(1, ...sorted.map(entry => entry.count))
            sections.push(h(Section, { key: 'activity', title: tp('sectionActivity'), extra: tp('sectionActivityCount', sorted.length) },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, tr('thEvent')),
                  h('th', { className: 'num' }, tr('thCount')),
                  h('th', { style: { width: '34%' } }, tr('thDistribution')))),
                h('tbody', null, sorted.slice(0, 10).map(entry => h('tr', { key: entry.kind },
                  h('td', null, activityLabel(entry.kind)),
                  h('td', { className: 'num' }, String(entry.count)),
                  h('td', null, h(Track, {
                    percent: (entry.count / max) * 100,
                    color: ACTIVITY_COLORS[entry.kind] ?? 'var(--dsw-alias-state-business-primary,#2563eb)',
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
              : tr('recallLane', laneSample.via ?? '—', laneSample.ids?.length ?? 0, laneSample.tokens ?? 0, laneSample.messages ?? 0)
            sections.push(h(Section, { key: 'requests', title: tp('sectionRequests'), extra: tp('sectionRequestsExtra', requests.length) },
              h('table', { className: 'chp-table' },
                h('thead', null, h('tr', null,
                  h('th', null, tr('thPurpose')),
                  h('th', null, tr('thModel')),
                  h('th', { className: 'num' }, tr('thEstimate')),
                  h('th', { className: 'num' }, tr('thInjected')),
                  h('th', { style: { width: '22%' } }, tr('thDistribution')))),
                h('tbody', null, requestRows)),
              laneLine === null ? null : h('div', { className: 'chp-note' }, laneLine)))
          }

          if (session === null || session === undefined) {
            sections.push(h('div', { key: 'noobs', className: 'chp-empty' }, tr('noSessionObs')))
          }
        }

        if (tab === 'config') {
          const setConfig = (key, value) => { if (onAction) onAction({ action: 'config', key, value }) }
          const editRow = (label, control, hint) => h('div', { key: label, className: 'chp-editrow' },
            h('span', null,
              h('span', { className: 'chp-editlabel' }, label),
              hint ? h('span', { className: 'chp-editrow-hint' }, hint) : null),
            h('span', { className: 'chp-editvalue' }, control))
          const ttlText = value => (Number(value) === 0 ? tr('ttlNever') : tr('dayUnit', value))
          const capabilities = [
            [tr('capSearch'), config.embedding === true ? tr('capVectorFusion', config.fusion ?? 'weighted') : tr('kwFts'), config.embedding === true ? '#10b981' : '#64748b'],
            [tr('capRewrite'), config.rewrite === true ? tr('on') : tr('off'), config.rewrite === true ? '#3b82f6' : '#94a3b8'],
            [tr('capRerank'), config.rerank === true ? tr('on') : tr('off'), config.rerank === true ? '#8b5cf6' : '#94a3b8'],
            [tr('capCompact'), snapshot.compactor === 'hub' ? tr('compactorHubValue') : 'native', '#f59e0b'],
            [tr('capWatermark'), config.watermark === true ? tr('on') : tr('off'), config.watermark === true ? '#f97316' : '#94a3b8'],
            [tr('capMode'), config.mode ?? 'auto', '#0ea5e9'],
          ]
          sections.push(h(Section, { key: 'config', title: tp('sectionConfig') },
            h('div', { className: 'chp-chips' }, capabilities.map(([label, value, color]) => h('span', {
              key: label,
              className: 'chp-chip-cap',
              title: `${label}：${value}`,
            },
              h('span', { className: 'chp-dot', style: { background: color } }),
              h('span', { className: 'chp-chip-cap-k' }, label),
              h('span', { className: 'chp-chip-cap-v' }, value)))),
            h('div', { className: 'chp-editgroup' },
              h('div', { className: 'chp-editgroup-title' }, tr('recallBudget')),
              editRow(tr('recallItems'), h(StepControl, {
                value: config.recallMaxItems ?? 8, min: 1, max: 20, step: 1,
                format: value => tr('itemsLabel', value),
                onChange: value => setConfig('recallMaxItems', value),
              })),
              editRow(tr('recallChars'), h(StepControl, {
                value: config.recallMaxChars ?? 1800, min: 200, max: 8000, step: 100,
                format: value => tr('charsLabel', value),
                onChange: value => setConfig('recallMaxChars', value),
              })),
              editRow(tr('recallCooldown'), h(StepControl, {
                value: config.cooldown ?? 6, min: 0, max: 20, step: 1,
                onChange: value => setConfig('recallCooldownTurns', value),
              })),
              editRow(tr('recallTokens'), h(StepControl, {
                value: config.recallMaxTokens ?? 1200, min: 100, max: 4000, step: 100,
                format: value => `${value} tokens`,
                onChange: value => setConfig('recallMaxTokens', value),
              })),
              editRow(tr('recallTimeout'), h(StepControl, {
                value: config.recallTimeoutMs ?? 4000, min: 0, max: 20000, step: 500,
                format: value => (Number(value) === 0 ? tr('unlimited') : tr('msLabel', value)),
                onChange: value => setConfig('recallTimeoutMs', value),
              }))),
            h('div', { className: 'chp-editgroup' },
              h('div', { className: 'chp-editgroup-title' }, tr('ttlGroup')),
              editRow('session', h(Segmented, {
                value: config.sessionTtlDays, options: [3, 7, 15, 30],
                format: value => tr('dayUnit', value),
                onChange: value => setConfig('sessionTtlDays', value),
              })),
              editRow('project', h(StepControl, {
                value: config.projectTtlDays ?? 90, min: 0, max: 3650, step: 30,
                format: ttlText,
                onChange: value => setConfig('projectTtlDays', value),
              })),
              editRow('global', h(StepControl, {
                value: config.globalTtlDays ?? 0, min: 0, max: 3650, step: 30,
                format: value => (Number(value) === 0 ? tr('ttlPermanent') : tr('dayUnit', value)),
                onChange: value => setConfig('globalTtlDays', value),
              }))),
            h('div', { className: 'chp-editgroup' },
              h('div', { className: 'chp-editgroup-title' }, tr('extractGroup')),
              editRow(tr('extractPasses'), h(StepControl, {
                value: config.extractPasses ?? 2, min: 1, max: 10, step: 1,
                onChange: value => setConfig('extractPassesPerTurn', value),
              })),
              editRow(tr('conflictPolicy'), h(Segmented, {
                value: config.conflictPolicy ?? 'evidence', options: ['evidence', 'recency'],
                format: value => (value === 'evidence' ? tr('policyEvidence') : tr('policyRecency')),
                onChange: value => setConfig('conflictPolicy', value),
              })))))
          const semanticToggles = [
            ['embedding.enabled', tr('vectorRecall'), config.embedding === true, tr('vectorHint')],
            ['rewrite.enabled', tr('queryRewrite'), config.rewrite === true, tr('rewriteHint')],
            ['rerank.enabled', tr('llmRerank'), config.rerank === true, tr('rerankHint')],
          ].map(([key, label, on, hint]) => h('div', { key, className: 'chp-toggle' },
            h('div', null,
              h('div', { style: { fontWeight: 600, fontSize: '12px' } }, `${label}: ${on ? tr('on') : tr('off')}`),
              h('div', { className: 'chp-sec-extra', style: { textTransform: 'none', letterSpacing: 0 } }, hint)),
            h('button', {
              type: 'button',
              className: `chp-switch${on ? ' chp-switch-on' : ''}`,
              'aria-label': `${on ? tr('disable') : tr('enable')} ${label}`,
              'aria-pressed': on,
              onClick: () => setConfig(key, !on),
            }, h('span', { className: 'chp-knob' }))))

          const toggles = [
            h('div', { key: 'sem-title', className: 'chp-editgroup-title' }, tr('semanticRecall')),
            ...semanticToggles,
            h('div', { key: 'wm-title', className: 'chp-editgroup-title' }, tr('compactTakeover')),
            h('div', { key: 'watermark', className: 'chp-toggle' },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: '12px' } },
                  tr('watermarkTitle', config.watermark === true ? tr('on') : tr('off'))),
                h('div', { className: 'chp-sec-extra', style: { textTransform: 'none', letterSpacing: 0 } },
                  tr('watermarkHint'))),
              h('button', {
                type: 'button',
                className: `chp-switch${config.watermark === true ? ' chp-switch-on' : ''}`,
                'aria-label': config.watermark === true ? tr('watermarkAriaOff') : tr('watermarkAriaOn'),
                'aria-pressed': config.watermark === true,
                onClick: () => { if (onToggleWatermark) onToggleWatermark() },
              }, h('span', { className: 'chp-knob' }))),
            h('div', { key: 'compactor', className: 'chp-toggle' },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: '12px' } },
                  tr('compactorTitle', snapshot.compactor === 'hub' ? tr('compactorHubValue') : 'native')),
                h('div', { className: 'chp-sec-extra', style: { textTransform: 'none', letterSpacing: 0 } },
                  tr('compactorHint'))),
              h('button', {
                type: 'button', className: 'chp-mini-btn',
                onClick: () => { if (onAction) onAction({ action: 'compactor', value: snapshot.compactor === 'hub' ? 'native' : 'hub' }) },
              }, snapshot.compactor === 'hub' ? tr('switchToNative') : tr('switchToHub'))),
            h('div', { key: 'mode', className: 'chp-toggle' },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: '12px' } },
                  tr('modeTitle', config.mode ?? 'auto')),
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
          sections.push(h('div', { key: 'storage', className: 'chp-note' }, `${tr('storage')}: ${snapshot.db}`))
        }
        
        // 语言设置页面
        if (tab === 'locale') {
          const locales = [
            { code: 'auto', name: tp('autoDetect'), desc: tp('autoDetectDesc') },
            { code: 'zh', name: '简体中文', desc: 'Chinese' },
            { code: 'en', name: 'English', desc: 'English' },
            { code: 'ja', name: '日本語', desc: 'Japanese' },
            { code: 'ko', name: '한국어', desc: 'Korean' },
            { code: 'de', name: 'Deutsch', desc: 'German' },
            { code: 'fr', name: 'Français', desc: 'French' },
            { code: 'es', name: 'Español', desc: 'Spanish' },
          ]
          
          const currentLocale = uiLocale !== undefined && uiLocale !== null && uiLocale !== ''
            ? String(uiLocale)
            : (snapshot && snapshot.config && snapshot.config.locale ? String(snapshot.config.locale) : 'auto')
          
          const localeRows = locales.map(lang => {
            const isActive = currentLocale === lang.code
            return h('div', { 
              key: lang.code, 
              className: 'chp-toggle',
              style: isActive ? { 
                background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2563eb) 6%, transparent)',
                borderColor: 'var(--dsw-alias-state-business-primary, #2563eb)'
              } : undefined
            },
              h('div', null,
                h('div', { style: { 
                  fontWeight: 600, 
                  fontSize: '12px',
                  color: isActive ? 'var(--dsw-alias-state-business-primary, #2563eb)' : 'inherit'
                } }, lang.name),
                h('div', { className: 'chp-sec-extra', style: { 
                  textTransform: 'none', 
                  letterSpacing: 0,
                  fontSize: '10.5px'
                } }, lang.desc)),
              h('button', {
                type: 'button',
                className: `chp-mini-btn${isActive ? ' ok' : ''}`,
                disabled: isActive,
                style: isActive ? { opacity: 0.6 } : undefined,
                onClick: () => {
                  if (currentLocale === lang.code) return
                  if (typeof onLocaleChange === 'function') onLocaleChange(lang.code)
                  else if (onAction) onAction({ action: 'locale', value: lang.code })
                },
              }, isActive ? tp('langEnabled') : tp('useThisLang')))
          })
          
          const activeLang = locales.find(l => l.code === currentLocale)
          sections.push(h('div', { key: 'locale-title', className: 'chp-editgroup-title' }, tp('localeTitle')),
            h('div', { key: 'locale-hint', className: 'chp-note', style: { marginBottom: '10px' } },
              tp('localeHint')),
            h('div', { key: 'locale-list' }, localeRows),
            h('div', { key: 'locale-current', className: 'chp-editgroup', style: { marginTop: '12px' } },
              h('div', { className: 'chp-editgroup-title' }, tp('localeCurrent')),
              h('div', { className: 'chp-chips' },
                h('span', { className: 'chp-chip-cap' },
                  h('span', { className: 'chp-chip-cap-k' }, tp('localeCurrentLang')),
                  h('span', { className: 'chp-chip-cap-v' }, activeLang ? activeLang.name : currentLocale)),
                h('span', { className: 'chp-chip-cap' },
                  h('span', { className: 'chp-chip-cap-k' }, tp('localeCommand')),
                  h('span', { className: 'chp-chip-cap-v' }, '/context-hub locale')))))
        }
      }

      const sessionLabel = session !== null && session !== undefined && session.id
        ? tp('panelSubSession', String(session.id).slice(0, 8))
        : tp('panelSubReadonly')
      const updated = snapshot === null
        ? tp('loading')
        : tp('updatedAt', new Date(snapshot.generatedAt).toLocaleTimeString())

      return h('div', {
        id: 'chp-backdrop',
        onClick: (event) => { if (event.target === event.currentTarget) onClose() },
        role: 'presentation',
      }, h('div', {
        className: 'chp-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': tp('panelTitle'),
      },
        h('div', { className: 'chp-head' },
          h('div', { className: 'chp-logo' }, 'CH'),
          h('div', { className: 'chp-titles' },
            h('h2', { className: 'chp-title' }, tp('panelTitle')),
            h('div', { className: 'chp-sub' }, `${sessionLabel} · ${tp('subSuffix')}`)),
          h('div', { className: 'chp-actions' },
            h('button', { type: 'button', className: 'chp-icon', title: tp('refresh'), onClick: onRefresh }, '↻'),
            h('button', { type: 'button', className: 'chp-icon', title: tp('close'), onClick: onClose, autoFocus: true }, '✕'))),
        session === null || session === undefined
          ? h('div', { className: 'chp-kpi' },
            h('div', { className: 'chp-empty' }, snapshot === null ? tp('loading') : tp('noSession')))
          : h('div', { className: 'chp-kpi' },
            h('div', { className: 'chp-hero' },
              h('div', { className: 'chp-ring' },
                ring(percent ?? 0, 78, 7, 'var(--dsw-alias-state-business-primary, #2563eb)'),
                h('div', { className: 'chp-ring-label' },
                  h('div', { className: 'chp-ring-num' }, percent === undefined ? '—' : `${percent}%`),
                  h('div', { className: 'chp-ring-cap' }, tr('pressure')))),
              h('div', { className: 'chp-stats' },
                h(Stat, { label: 'surface', value: `${fmt(session.surfaceTokens)} tokens`, title: String(session.surfaceTokens), icon: 'layers', color: '#3b82f6' }),
                h(Stat, { label: tr('totalLabel'), value: `${fmt(session.totalTokens)} tokens`, title: String(session.totalTokens), icon: 'sum', color: '#8b5cf6' }),
                h(Stat, { label: tr('nodesEvents'), value: `${fmt(session.nodes)} / ${fmt(session.events)}`, icon: 'grid', color: '#10b981' }),
                h(Stat, { label: tr('outputReserve'), value: `${fmt(session.outputReserve)} tokens`, icon: 'out', color: '#f59e0b' })))),
        snapshot === null ? null : h(Tabs, { tabs, active: tab, onChange: setTab }),
        h('div', { className: 'chp-scroll' }, sections),
        h('div', { className: 'chp-foot' },
          h('span', null, tr('footerNote')),
          h('span', null, tr('refreshedNote', updated)))))
    }

    async function readError(response) {
      try {
        const body = await response.json()
        const message = body !== null && typeof body === 'object' ? (body.error ?? body.message) : undefined
        return typeof message === 'string' && message.length > 0 ? message : `HTTP ${response.status}`
      } catch {
        return `HTTP ${response.status}`
      }
    }

    // 左栏 footer 是 root scope，拿不到 sessionId；由 composer 座位把当前会话 id 记下来共享。
    let currentSessionId = ''
    const sessionIdListeners = new Set()
    function rememberSessionId(id) {
      const next = typeof id === 'string' ? id : ''
      if (next === '' || next === currentSessionId) return
      currentSessionId = next
      for (const listener of sessionIdListeners) listener(next)
    }

    function Pill(props) {
      const sessionId = props.sessionId
      const compact = props.compact === true
      const showText = props.showText !== false
      const [snapshot, setSnapshot] = React.useState(null)
      const [failed, setFailed] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [uiLocale, setUiLocale] = React.useState(readStoredLocale)
      const busyRef = React.useRef(false)

      // 服务端返回的持久化语言：仅在本地没有显式选择时采纳，避免覆盖用户刚做的切换
      React.useEffect(() => {
        if (snapshot === null || snapshot.config === null || snapshot.config === undefined) return
        const serverLocale = snapshot.config.locale
        if (typeof serverLocale !== 'string' || serverLocale === '') return
        let stored = 'auto'
        try { stored = localStorage.getItem(LOCALE_KEY) || 'auto' } catch { /* 忽略 */ }
        if (stored === 'auto' && serverLocale !== 'auto') {
          setUiLocale(serverLocale)
          storeLocale(serverLocale)
        }
      }, [snapshot])

      // 语言切换：先改本地状态即时生效，再尽力落库（服务端未重启时失败也不打扰用户）
      const changeLocale = React.useCallback(async (code) => {
        const next = String(code)
        setUiLocale(next)
        storeLocale(next)
        try {
          await fetch(ACTION_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'locale', value: next }),
          })
        } catch { /* 同步失败不影响本地切换 */ }
      }, [])

      const load = React.useCallback((signal) => fetch(
        `${PATH}?sessionId=${encodeURIComponent(String(sessionId ?? ''))}&t=${Date.now()}`,
        { signal, credentials: 'same-origin' },
      ).then(async response => {
        if (response.ok) return response.json()
        throw new Error(await readError(response))
      })
        .then(json => {
          if (signal !== undefined && signal.aborted) return
          setSnapshot(json)
          if (json.ok === false) setFailed(String(json.error ?? tr('unknownError')))
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
        if (busyRef.current) return
        const current = snapshot !== null && snapshot.config !== null && snapshot.config !== undefined
          ? snapshot.config.watermark === true
          : false
        busyRef.current = true
        try {
          const response = await fetch(WATERMARK_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: current !== true }),
          })
          if (!response.ok) throw new Error(await readError(response))
          await load()
        } catch (error) {
          setFailed(String(error))
        } finally {
          busyRef.current = false
        }
      }, [snapshot, load])

      const reviewAction = React.useCallback(async (id, action) => {
        if (busyRef.current) return
        busyRef.current = true
        try {
          const response = await fetch(REVIEW_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, action }),
          })
          if (!response.ok) throw new Error(await readError(response))
          await load()
        } catch (error) {
          setFailed(String(error))
        } finally {
          busyRef.current = false
        }
      }, [load])

      const runAction = React.useCallback(async (payload) => {
        if (busyRef.current) return
        busyRef.current = true
        try {
          const response = await fetch(ACTION_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) throw new Error(await readError(response))
          await load()
        } catch (error) {
          setFailed(String(error))
        } finally {
          busyRef.current = false
        }
      }, [load])

      const memory = snapshot !== null && snapshot.memory !== null && snapshot.memory !== undefined ? snapshot.memory.active : undefined
      const pending = snapshot !== null && snapshot.memory !== null && snapshot.memory !== undefined ? snapshot.memory.pending : undefined
      const pressure = snapshot !== null && snapshot.session !== null ? snapshot.session.pressure : undefined
      const contextWindow = snapshot !== null && snapshot.session !== null ? snapshot.session.contextWindow : undefined
      const percent = pressure !== undefined && contextWindow
        ? Math.max(0, Math.min(100, Math.round((pressure / contextWindow) * 100)))
        : undefined

      // 胶囊按钮文案也跟随语言
      const pillLocale = effectiveLocale(uiLocale)
      const pt = (key, ...args) => tPanel(pillLocale, key, ...args)

      const label = snapshot === null
        ? (failed === null ? pt('pillLoading') : pt('pillUnavailable'))
        : pt('pillContext', percent === undefined ? '—' : `${percent}%`)

      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: compact ? 'chp-pill chp-chip' : 'chp-pill',
          title: pending ? pt('pillTitlePending', pending) : pt('pillTitle'),
          onClick: () => setOpen(value => !value),
        },
          percent === undefined ? null : ring(percent, 18, 2.5, 'var(--dsw-alias-state-business-primary, #2563eb)'),
          showText ? h('span', { className: 'chp-pill-strong' }, compact ? (percent === undefined ? '—' : `${percent}%`) : label) : null,
          compact ? null : h('span', { className: 'chp-pill-dim' }, pt('pillMemory', memory ?? '—')),
          pending ? h('span', { className: 'chp-pill-warn', title: pt('pendingBadge', pending) }) : null),
        open ? createPortal(h(Panel, {
          snapshot,
          failed,
          uiLocale,
          onLocaleChange: changeLocale,
          onRefresh: () => { setFailed(null); load() },
          onToggleWatermark: toggleWatermark,
          onReview: reviewAction,
          onAction: runAction,
          onClose: () => setOpen(false),
        }), document.body) : null)
    }

    function ComposerAnchor(props) {
      const sessionId = props.sessionId
      React.useEffect(() => { rememberSessionId(sessionId) }, [sessionId])
      return null
    }

    function SidebarChip(props) {
      const [sessionId, setSessionId] = React.useState(currentSessionId)
      React.useEffect(() => {
        sessionIdListeners.add(setSessionId)
        return () => { sessionIdListeners.delete(setSessionId) }
      }, [])
      return h(Pill, { sessionId, compact: true, showText: props.wide !== false })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'context-hub-status',
          order: 2,
        }, SidebarChip))
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'context-hub-session',
          order: 2,
        }, ComposerAnchor))
      },
    }
  },
})

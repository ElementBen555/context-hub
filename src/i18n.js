/**
 * dsh-context-hub 国际化模块
 * 
 * 功能：
 * - 自动检测系统语言
 * - 支持多语言切换
 * - 语言回退机制
 * - 运行时语言配置
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALE_DIR = join(__dirname, '..', 'locale')

// 支持的語言列表
export const SUPPORTED_LOCALES = ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es']

// 语言别名映射
export const LOCALE_ALIASES = {
  'zh-CN': 'zh',
  'zh-SG': 'zh',
  'zh-TW': 'zh',
  'zh-HK': 'zh',
  'en-US': 'en',
  'en-GB': 'en',
  'en-AU': 'en',
  'en-CA': 'en',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'de-DE': 'de',
  'fr-FR': 'fr',
  'es-ES': 'en',
  'es-MX': 'es',
}

// 语言显示名称
export const LOCALE_NAMES = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
}

// 运行时缓存
let currentLocale = null
let localeData = {}
let configPath = null

/**
 * 检测系统语言
 * @returns {string} 检测到的语言代码
 */
export function detectSystemLocale() {
  // 1. 检查环境变量
  const envLang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || ''
  if (envLang) {
    const matched = envLang.match(/^([a-z]{2})/)
    if (matched) {
      const locale = LOCALE_ALIASES[matched[0]] || matched[0]
      if (SUPPORTED_LOCALES.includes(locale)) {
        return locale
      }
    }
  }

  // 2. 检查 NODE_OPTIONS 或其他 DSH 相关环境变量
  const dshLocale = process.env.DSH_LOCALE || process.env.DSH_CONTEXT_HUB_LOCALE
  if (dshLocale) {
    const locale = LOCALE_ALIASES[dshLocale] || dshLocale
    if (SUPPORTED_LOCALES.includes(locale)) {
      return locale
    }
  }

  // 3. 默认返回中文（主要用户群体）
  return 'zh'
}

/**
 * 规范化语言代码
 * @param {string} locale 语言代码
 * @returns {string} 规范化后的语言代码
 */
export function normalizeLocale(locale) {
  if (!locale) return 'zh'
  const normalized = LOCALE_ALIASES[locale] || locale
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : 'zh'
}

/**
 * 加载语言文件
 * @param {string} locale 语言代码
 * @returns {Object} 语言数据
 */
function loadLocaleFile(locale) {
  const filePath = join(LOCALE_DIR, `${locale}.json`)
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch (err) {
    console.error(`[context-hub i18n] 加载语言文件失败 ${locale}:`, err.message)
  }
  return {}
}

/**
 * 递归合并对象
 * @param {Object} target 目标对象
 * @param {Object} source 源对象
 * @returns {Object} 合并后的对象
 */
function mergeObjects(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeObjects(result[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

/**
 * 初始化国际化系统
 * @param {string} [configDir] 配置目录路径
 * @param {string} [preferredLocale] 首选语言
 * @returns {Object} 初始化结果
 */
export function initI18n(configDir, preferredLocale) {
  configPath = configDir ? join(configDir, 'context-hub-config.json') : null
  
  // 1. 加载首选语言或检测系统语言
  let locale = preferredLocale ? normalizeLocale(preferredLocale) : detectSystemLocale()
  
  // 2. 尝试从配置文件读取
  if (configPath && existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (config.locale && SUPPORTED_LOCALES.includes(config.locale)) {
        locale = config.locale
      }
    } catch (err) {
      // 忽略配置文件错误
    }
  }
  
  // 3. 加载主语言文件
  localeData = loadLocaleFile(locale)
  
  // 4. 如果主语言不完整，加载英文作为回退
  if (locale !== 'en') {
    const enData = loadLocaleFile('en')
    localeData = mergeObjects(enData, localeData)
  }
  
  // 5. 确保 meta 字段存在
  if (!localeData.meta) {
    localeData.meta = loadLocaleFile('en').meta || {}
  }
  
  currentLocale = locale
  
  return {
    locale,
    supportedLocales: SUPPORTED_LOCALES,
    localeNames: LOCALE_NAMES,
  }
}

/**
 * 获取当前语言
 * @returns {string} 当前语言代码
 */
export function getCurrentLocale() {
  return currentLocale || 'zh'
}

/**
 * 切换语言
 * @param {string} locale 目标语言
 * @returns {Object} 切换结果
 */
export function setLocale(locale) {
  const normalized = normalizeLocale(locale)
  if (normalized === currentLocale) {
    return { success: true, locale: currentLocale, changed: false }
  }
  
  // 加载新语言
  localeData = loadLocaleFile(normalized)
  
  // 回退机制
  if (normalized !== 'en') {
    const enData = loadLocaleFile('en')
    localeData = mergeObjects(enData, localeData)
  }
  
  currentLocale = normalized
  
  // 保存到配置文件
  if (configPath) {
    try {
      let config = {}
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'))
      }
      config.locale = normalized
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[context-hub i18n] 保存语言配置失败:', err.message)
    }
  }
  
  return { success: true, locale: normalized, changed: true }
}

/**
 * 获取翻译文本
 * @param {string} key 翻译键（支持点号路径，如 'commands.help.description'）
 * @param {Object} [params] 替换参数
 * @returns {string} 翻译文本
 */
export function t(key, params = {}) {
  if (!key) return ''
  
  // 解析键路径
  const keys = key.split('.')
  let value = localeData
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k]
    } else {
      // 键不存在，返回键本身
      return key
    }
  }
  
  if (typeof value !== 'string') {
    return key
  }
  
  // 参数替换
  let result = value
  for (const [paramKey, paramValue] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue))
  }
  
  return result
}

/**
 * 批量获取翻译
 * @param {string[]} keys 翻译键列表
 * @returns {Object} 键值对
 */
export function tBatch(keys) {
  const result = {}
  for (const key of keys) {
    result[key] = t(key)
  }
  return result
}

/**
 * 获取所有支持的語言
 * @returns {Object} 语言代码到名称的映射
 */
export function getSupportedLocales() {
  const result = {}
  for (const locale of SUPPORTED_LOCALES) {
    result[locale] = LOCALE_NAMES[locale] || locale
  }
  return result
}

/**
 * 获取语言统计信息
 * @returns {Object} 语言覆盖统计
 */
export function getLocaleStats() {
  const zhData = loadLocaleFile('zh')
  const enData = loadLocaleFile('en')
  const currentData = localeData
  
  function countKeys(obj, prefix = '') {
    let count = 0
    for (const key of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        count += countKeys(obj[key], fullKey)
      } else {
        count++
      }
    }
    return count
  }
  
  return {
    zh: countKeys(zhData),
    en: countKeys(enData),
    current: countKeys(currentData),
    currentLocale,
  }
}

/**
 * 导出翻译到文件
 * @param {string} locale 语言代码
 * @param {Object} data 翻译数据
 * @returns {boolean} 是否成功
 */
export function exportLocale(locale, data) {
  const filePath = join(LOCALE_DIR, `${locale}.json`)
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error(`[context-hub i18n] 导出语言文件失败 ${locale}:`, err.message)
    return false
  }
}

// 默认初始化（延迟执行）
let initialized = false
export function ensureInitialized(configDir, preferredLocale) {
  if (!initialized) {
    initI18n(configDir, preferredLocale)
    initialized = true
  }
  return getCurrentLocale()
}

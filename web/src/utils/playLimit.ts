// 每日通话限制系统：文字通话 / 语音通话 各自独立计数
// 每天（UTC+8）重置，1 次免费 + 分享 1 次 = 最多 2 次/天/模式

export type ChatMode = 'text' | 'voice';

const STORAGE_KEY = 'rocky_daily_v2';

interface ModeData {
  used: number;       // 今日已用次数
  shared: boolean;    // voice: 今日是否已分享（只能一次）
  shareCount: number; // text: 今日分享次数（无上限）
}

interface DailyData {
  date: string;     // YYYY-MM-DD (UTC+8)
  text: ModeData;
  voice: ModeData;
}

// ── UTC+8 日期 ──
function getTodayUTC8(): string {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 3600000);
  return utc8.toISOString().slice(0, 10);
}

// ── 距离 UTC+8 午夜的剩余时间 ──
export function getTimeUntilReset(): { hours: number; minutes: number } {
  const now = new Date();
  // UTC+8 的当前时间
  const utc8Now = new Date(now.getTime() + 8 * 3600000);
  // UTC+8 的明天 00:00
  const tomorrow = new Date(utc8Now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  const diff = tomorrow.getTime() - utc8Now.getTime();
  return {
    hours: Math.floor(diff / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
  };
}

export function formatResetTime(): string {
  const { hours, minutes } = getTimeUntilReset();
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

// ── 数据读写 ──
function getData(): DailyData {
  const today = getTodayUTC8();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data: DailyData = JSON.parse(raw);
      if (data.date === today) return data;
    }
  } catch { /* */ }
  // 新的一天或首次
  return { date: today, text: { used: 0, shared: false, shareCount: 0 }, voice: { used: 0, shared: false, shareCount: 0 } };
}

function saveData(data: DailyData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* */ }
}

// ── 公开 API ──

/** 获取某模式今日可用总次数 */
function getTotalPlays(m: ModeData, mode: ChatMode): number {
  if (mode === 'text') return 1 + (m.shareCount || 0); // 1 免费 + 每次分享 +1（无上限）
  return 1 + (m.shared ? 1 : 0);                       // 1 免费 + 分享最多 1 次
}

/** 获取某模式今日剩余次数 */
export function getRemainingPlays(mode: ChatMode): number {
  if (import.meta.env.DEV) return 999;
  const data = getData();
  const m = data[mode];
  return Math.max(0, getTotalPlays(m, mode) - m.used);
}

/** 消耗一次（开始新会话时调用） */
export function consumePlay(mode: ChatMode): boolean {
  const data = getData();
  const m = data[mode];
  if (m.used >= getTotalPlays(m, mode)) return false;
  m.used += 1;
  saveData(data);
  return true;
}

/** 退还一次 */
export function refundPlay(mode: ChatMode): void {
  const data = getData();
  const m = data[mode];
  if (m.used > 0) {
    m.used -= 1;
    saveData(data);
  }
}

/** 是否可以通过分享获取额外一次 */
export function canShareForBonus(mode: ChatMode): boolean {
  if (mode === 'text') return true; // text 模式无限分享
  return !getData()[mode].shared;   // voice 模式每日一次
}

/** 标记分享，获得 +1。返回是否成功 */
export function markShared(mode: ChatMode): boolean {
  const data = getData();
  if (mode === 'text') {
    data[mode].shareCount = (data[mode].shareCount || 0) + 1;
    saveData(data);
    return true;
  }
  // voice: 每日只能分享一次
  if (data[mode].shared) return false;
  data[mode].shared = true;
  saveData(data);
  return true;
}

// ── API 额度状态（跨会话记忆，跨天自动恢复） ──
const TTS_QUOTA_KEY = 'rocky_tts_quota';
const CHAT_QUOTA_KEY = 'rocky_chat_quota';

export function setTtsQuotaExceeded() {
  localStorage.setItem(TTS_QUOTA_KEY, getTodayUTC8());
}

export function isTtsQuotaExceeded(): boolean {
  const stored = localStorage.getItem(TTS_QUOTA_KEY);
  if (!stored) return false;
  return stored === getTodayUTC8();
}

export function setChatQuotaExceeded() {
  localStorage.setItem(CHAT_QUOTA_KEY, getTodayUTC8());
}

export function isChatQuotaExceeded(): boolean {
  const stored = localStorage.getItem(CHAT_QUOTA_KEY);
  if (!stored) return false;
  return stored === getTodayUTC8();
}

// P4: clear all client-side quota flags. Called after a successful login so
// the device's previous "quota exhausted" state doesn't keep the mode buttons
// disabled when the server has already granted unlimited access.
export function clearAllQuotaFlags() {
  localStorage.removeItem(TTS_QUOTA_KEY);
  localStorage.removeItem(CHAT_QUOTA_KEY);
}

// ── 兼容旧 API（供未迁移的代码使用） ──
export function getShareUrl(): string {
  return window.location.origin + window.location.pathname;
}

export function getShareCount(): number {
  return 0;
}

import { useCallback, useSyncExternalStore } from "react";

const KEY = "maota.lang";

export const LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

const DICT: Record<string, Record<string, string>> = {
  "zh-CN": {
    newChat: "新对话",
    tasks: "定时任务",
    plugins: "插件",
    pluginList: "已装配的插件",
    capability: "能力",
    provider: "插件",
    workspaces: "项目",
    sessions: "会话",
    addProject: "添加项目",
    noWorkdir: "无项目: 会话落在 sessions/default",
    pathPlaceholder: "绝对路径, 回车确认",
    noSessions: "还没有对话",
    running: "在跑",
    settings: "设置",
    defaultProject: "无项目",
    pinned: "置顶",
    archived: "已归档",
    newSession: "新建会话",
    more: "更多",
    rename: "重命名",
    removeProject: "删除项目",
    pin: "置顶",
    unpin: "取消置顶",
    archive: "归档",
    restore: "取消归档",
    searchChats: "搜索对话",
    quick: "快捷操作",
    openFolder: "打开文件夹",
    clear: "清空",
    followSystem: "系统",
    appearance: "外观",
    dark: "深色",
    light: "浅色",
    chats: "聊天",
    noChats: "没有匹配的对话",
    retry: "重试",
    inputPlaceholder: "随心所欲",
    permission: "权限",
    askApproval: "请求批准",
    autoApprove: "帮我批准",
    fullAccess: "完全访问权限",
    permissionAsk: "应如何批准 MaoTa 的操作？",
    askNote: "编辑外部文件和使用互联网时始终询问",
    autoNote: "仅对检测到的风险操作请求批准",
    fullNote: "不受限制的访问一切",
    send: "发送",
    stop: "停止",
    thinking: "思考档位",
    step: "第 {n} 步",
    waiting: ", 等模型开口…",
    thinkingText: "思考",
    keyMissing: "还没配 API Key：填一个就能开始聊",
    save: "保存",
    saving: "保存中…",
    general: "通用",
    personalization: "个性化",
    language: "语言",
    backToApp: "返回应用",
    searchSettings: "搜索设置…",
    personal: "常规",
    system: "集成",
    about: "插件",
    languageNote: "界面显示语言",
    noMatch: "没有匹配的设置",
    errKey: "API key 无效或没权限",
    errRate: "网关限流, 稍后再试",
    errGateway: "网关错误, 检查 base_url",
    errBroken: "连接中断, 本轮未完成",
    errGarbage: "网关返回了看不懂的数据",
    errEmpty: "网关没给出回答",
    errTimeout: "超时",
    errCancelled: "已取消",
    errUnavailable: "提供方不可用",
    errUnknown: "未知错误: {code} {message}",
  },
  en: {
    newChat: "New chat",
    tasks: "Scheduled tasks",
    plugins: "Plugins",
    pluginList: "Wired plugins",
    capability: "Capability",
    provider: "Plugin",
    workspaces: "Projects",
    sessions: "Sessions",
    addProject: "Add project",
    noWorkdir: "No project: sessions land in sessions/default",
    pathPlaceholder: "Absolute path, Enter to confirm",
    noSessions: "No chats yet",
    running: "Running",
    settings: "Settings",
    defaultProject: "No project",
    pinned: "Pinned",
    archived: "Archived",
    newSession: "New session",
    more: "More",
    rename: "Rename",
    removeProject: "Delete project",
    pin: "Pin",
    unpin: "Unpin",
    archive: "Archive",
    restore: "Unarchive",
    searchChats: "Search chats",
    quick: "Quick actions",
    openFolder: "Open folder",
    clear: "Clear",
    followSystem: "System",
    appearance: "Appearance",
    dark: "Dark",
    light: "Light",
    chats: "Chats",
    noChats: "No matching chats",
    retry: "Retry",
    inputPlaceholder: "Whatever you want",
    permission: "Permission",
    askApproval: "Ask for approval",
    autoApprove: "Approve for me",
    fullAccess: "Full access",
    permissionAsk: "How should MaoTa actions be approved?",
    askNote: "Always ask before touching files outside or using the internet",
    autoNote: "Only ask for approval on actions flagged as risky",
    fullNote: "Unrestricted access to everything",
    send: "Send",
    stop: "Stop",
    thinking: "Thinking level",
    step: "Step {n}",
    waiting: ", waiting for the model…",
    thinkingText: "Thinking",
    keyMissing: "No API key yet: add one to start chatting",
    save: "Save",
    saving: "Saving…",
    general: "Common",
    personalization: "Personalization",
    language: "Language",
    backToApp: "Back to app",
    searchSettings: "Search settings…",
    personal: "General",
    system: "Integrations",
    about: "Plugins",
    languageNote: "Language used by the interface",
    noMatch: "No matching settings",
    errKey: "API key is invalid or not permitted",
    errRate: "Gateway rate limit, try again later",
    errGateway: "Gateway error, check base_url",
    errBroken: "Connection dropped, this round did not finish",
    errGarbage: "The gateway returned unreadable data",
    errEmpty: "The gateway gave no answer",
    errTimeout: "Timed out",
    errCancelled: "Cancelled",
    errUnavailable: "Provider unavailable",
    errUnknown: "Unknown error: {code} {message}",
  },
};

const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function read(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "system" || (raw !== null && DICT[raw] !== undefined) ? raw : "system";
  } catch {
    return "system";
  }
}

function resolve(preference: string): string {
  if (DICT[preference] !== undefined) return preference;
  const spoken = typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
  return spoken.startsWith("zh") ? "zh-CN" : "en";
}

let preference = read();
let lang = resolve(preference);

export function getLang(): string {
  return lang;
}

export function getLangPref(): string {
  return preference;
}

export function setLang(next: string): void {
  if (next !== "system" && DICT[next] === undefined) return;
  preference = next;
  lang = resolve(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
  }
  document.documentElement.lang = lang;
  for (const listener of listeners) listener();
}

export function tr(lang: string, key: string, vars?: Record<string, string | number>): string {
  let text = DICT[lang]?.[key] ?? DICT["zh-CN"]?.[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
  return text;
}

export function useLang(): string {
  return useSyncExternalStore(subscribe, getLang);
}

export function useLangPref(): string {
  return useSyncExternalStore(subscribe, getLangPref);
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => tr(lang, key, vars), [lang]);
}

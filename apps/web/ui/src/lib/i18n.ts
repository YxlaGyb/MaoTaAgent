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
    workspaces: "工作区",
    sessions: "会话",
    addWorkspace: "添加工作区（选一个文件夹）",
    noWorkdir: "没有工作目录: 落在 sessions/default",
    pathPlaceholder: "绝对路径, 回车确认",
    noSessions: "这个工作区还没有对话",
    running: "在跑",
    settings: "设置",
    defaultProject: "默认",
    retry: "重试",
    inputPlaceholder: "随心输入",
    permission: "权限",
    askApproval: "请求批准",
    autoApprove: "帮我批准",
    fullAccess: "完全访问权限",
    permissionAsk: "应如何批准 MaoTa 的操作？",
    askNote: "编辑外部文件和使用互联网时始终询问",
    autoNote: "仅对检测到的风险操作请求批准",
    fullNote: "可不受限制地访问互联网和你电脑上的任何文件",
    reset: "重置",
    send: "发送",
    stop: "停止",
    thinking: "思考档位",
    step: "第 {n} 步",
    waiting: ", 等模型开口…",
    thinkingText: "思考",
    keyMissing: "还没配 API Key —— 填一个就能开始聊",
    save: "保存",
    saving: "保存中…",
    configured: "已配置",
    general: "通用设置",
    language: "语言",
    backToApp: "返回应用",
    searchSettings: "搜索设置…",
    personal: "个人",
    system: "系统",
    about: "关于",
    version: "版本",
    sessionsDir: "会话目录",
    languageNote: "界面显示语言",
    keyNote: "调用模型服务用的密钥",
    permissionNote: "运行工具时怎么向你确认",
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
    workspaces: "Workspaces",
    sessions: "Sessions",
    addWorkspace: "Add a workspace (pick a folder)",
    noWorkdir: "No working directory: sessions/default",
    pathPlaceholder: "Absolute path, Enter to confirm",
    noSessions: "No conversations in this workspace yet",
    running: "Running",
    settings: "Settings",
    defaultProject: "Default",
    retry: "Retry",
    inputPlaceholder: "Type anything",
    permission: "Permission",
    askApproval: "Ask for approval",
    autoApprove: "Approve for me",
    fullAccess: "Full access",
    permissionAsk: "How should MaoTa actions be approved?",
    askNote: "Always ask before touching files outside or using the internet",
    autoNote: "Only ask for approval on actions flagged as risky",
    fullNote: "Unrestricted access to the internet and any file on your computer",
    reset: "Reset",
    send: "Send",
    stop: "Stop",
    thinking: "Thinking level",
    step: "Step {n}",
    waiting: ", waiting for the model…",
    thinkingText: "Thinking",
    keyMissing: "No API key yet — add one to start chatting",
    save: "Save",
    saving: "Saving…",
    configured: "Configured",
    general: "General",
    language: "Language",
    backToApp: "Back to app",
    searchSettings: "Search settings…",
    personal: "Personal",
    system: "System",
    about: "About",
    version: "Version",
    sessionsDir: "Sessions directory",
    languageNote: "Language used by the interface",
    keyNote: "Credential used to call the model service",
    permissionNote: "How to confirm with you before running tools",
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

function read(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return raw !== null && DICT[raw] !== undefined ? raw : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

let lang = read();

export function getLang(): string {
  return lang;
}

export function setLang(next: string): void {
  if (DICT[next] === undefined) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
  }
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function tr(lang: string, key: string, vars?: Record<string, string | number>): string {
  let text = DICT[lang]?.[key] ?? DICT["zh-CN"]?.[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
  return text;
}

export function useLang(): string {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getLang);
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => tr(lang, key, vars), [lang]);
}

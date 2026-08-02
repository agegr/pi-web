// redaction.ts —— 递归类型守卫脱敏器（Q5 / 等价迁移 autoplan platform/redaction.redaction.go:81-189）
//
// 上游用 Go reflect 递归遍历任意结构，对敏感字段做脱敏（对应 reflect 递归脱敏重写为 TS）。
// 纯 TS 等价实现：基于 typeof / Array.isArray / Object 守卫的递归脱敏，不依赖反射。
// 用于进程/终端/日志输出中出现的敏感数据（密钥、token、密码、私钥等）脱敏后再落盘/展示。

/** 敏感键名匹配（大小写不敏感）。命中则整体脱敏为 <redacted>。 */
const SENSITIVE_KEY_RE =
  /(api[_-]?key|secret|token|auth|password|passwd|pwd|authorization|cookie|session|private[_-]?key|access[_-]?key|client[_-]?secret|bearer|credential)/i;

/** 疑似密钥/ token 值的高熵字符串（长度阈值 + 字符集），命中则部分掩码。 */
const SECRET_VALUE_RE = /^[A-Za-z0-9_\-+/=]{20,}$/;

const MASK = "<redacted>";

/** 递归脱敏任意值。
 *  - 对象：逐键检查，敏感键整体替换；普通键递归脱敏值。
 *  - 数组：逐元素递归。
 *  - 字符串：疑似高熵密钥则部分掩码（保留前缀 4 位便于排查，其余打码）。
 *  - 其它类型原样返回。
 *  @param maxDepth 防御性深度上限，避免循环引用（含自引用）导致爆栈。 */
export function sanitize(value: unknown, maxDepth = 16): unknown {
  return sanitizeRec(value, maxDepth);
}

function sanitizeRec(value: unknown, depth: number): unknown {
  if (depth <= 0) return MASK;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeRec(v, depth - 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = MASK;
      } else {
        out[k] = sanitizeRec(v, depth - 1);
      }
    }
    return out;
  }
  return value;
}

function sanitizeString(s: string): string {
  if (s.length > 2000) return `${s.slice(0, 2000)}…[truncated]`;
  if (SECRET_VALUE_RE.test(s)) {
    return `${s.slice(0, 4)}${"*".repeat(Math.max(4, s.length - 4))}`;
  }
  // 含常见密钥前缀的整串打码。
  if (/^(sk-|pk-|AKIA|ghp_|glpat-|xox[baprs]-|eyJ)/.test(s)) {
    return `${s.slice(0, 4)}${"*".repeat(Math.max(4, s.length - 4))}`;
  }
  return s;
}

/** 便捷函数：脱敏后序列化为 JSON 字符串（用于日志/事件落盘）。 */
export function sanitizeJson(value: unknown): string {
  try {
    return JSON.stringify(sanitize(value));
  } catch {
    return MASK;
  }
}

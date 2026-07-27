/** 认证表单提交所需的字段集合。 */
type AuthFormValues = Record<string, FormDataEntryValue>;

/** 认证表单提交的输入参数。 */
type SubmitAuthFormOptions = {
  mode: "login" | "setup";
  values: AuthFormValues;
  request: typeof fetch;
  onSuccess: () => void;
};

/**
 * 认证 API 返回的稳定错误码。
 * @remarks 客户端根据当前语言将错误码映射为可读文案。
 */
export type AuthErrorCode =
  | "AUTH_INVALID_PARAMETERS"
  | "AUTH_PASSWORD_MISMATCH"
  | "AUTH_LOGIN_RATE_LIMITED"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_SETUP_RATE_LIMITED"
  | "AUTH_SETUP_TOKEN_INVALID"
  | "AUTH_ALREADY_INITIALIZED"
  | "AUTH_PASSWORD_INVALID"
  | "AUTH_SETUP_FAILED"
  | "AUTH_NETWORK_ERROR";

type SubmitAuthFormResult = { ok: true } | { ok: false; errorCode: AuthErrorCode };

function getAuthErrorCode(mode: "login" | "setup", status: number): AuthErrorCode {
  if (status === 429) return mode === "setup" ? "AUTH_SETUP_RATE_LIMITED" : "AUTH_LOGIN_RATE_LIMITED";
  return mode === "setup" ? "AUTH_SETUP_FAILED" : "AUTH_LOGIN_FAILED";
}

/**
 * 提交登录或初始化认证请求，并在成功时调用回调。
 * @param options 提交模式、表单值、请求函数和成功回调。
 * @param options.mode 当前认证模式。
 * @param options.values 要提交的表单值。
 * @param options.request 用于发送请求的 fetch 实现。
 * @param options.onSuccess 请求成功后的回调。
 * @returns 表示提交成功或失败及其通用错误文案的结果。
 * @throws 不会抛出请求异常；请求异常会转换为通用失败结果。
 */
export async function submitAuthForm({ mode, values, request, onSuccess }: SubmitAuthFormOptions): Promise<SubmitAuthFormResult> {
  if (mode === "setup" && values.password !== values.confirmPassword) {
    return { ok: false, errorCode: "AUTH_PASSWORD_MISMATCH" };
  }

  try {
    const response = await request(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { errorCode?: AuthErrorCode } | null;
      return { ok: false, errorCode: body?.errorCode ?? getAuthErrorCode(mode, response.status) };
    }
    onSuccess();
    return { ok: true };
  } catch {
    return { ok: false, errorCode: "AUTH_NETWORK_ERROR" };
  }
}

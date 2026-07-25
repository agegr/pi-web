/** 认证表单提交所需的字段集合。 */
type AuthFormValues = Record<string, FormDataEntryValue>;

/** 认证表单提交的输入参数。 */
type SubmitAuthFormOptions = {
  mode: "login" | "setup";
  values: AuthFormValues;
  request: typeof fetch;
  onSuccess: () => void;
};

/** 认证表单提交的结果。 */
type SubmitAuthFormResult = { ok: true } | { ok: false; error: string };

function getAuthErrorMessage(status: number): string {
  return status === 429 ? "操作过于频繁，请稍后再试" : "认证失败，请稍后再试";
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
    return { ok: false, error: "两次密码不一致" };
  }

  try {
    const response = await request(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!response.ok) return { ok: false, error: getAuthErrorMessage(response.status) };
    onSuccess();
    return { ok: true };
  } catch {
    return { ok: false, error: "认证失败，请稍后再试" };
  }
}

/** Set of fields required to submit an authentication form. */
type AuthFormValues = Record<string, FormDataEntryValue>;

/** Input parameters for submitting an authentication form. */
type SubmitAuthFormOptions = {
  mode: "login" | "setup";
  values: AuthFormValues;
  request: typeof fetch;
  onSuccess: () => void;
};

/**
 * Stable error codes returned by the authentication API.
 * @remarks The client maps error codes to readable text using the current language.
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
 * Submit a login or authentication setup request and call the callback on success.
 * @param options Submission mode, form values, request function, and success callback.
 * @param options.mode Current authentication mode.
 * @param options.values Form values to submit.
 * @param options.request fetch implementation used to send the request.
 * @param options.onSuccess Callback after a successful request.
 * @returns Result indicating success or failure with a generic error code.
 * @throws Does not throw request errors; request errors are converted to a generic failure result.
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

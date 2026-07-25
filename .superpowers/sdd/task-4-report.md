# Task 4 Report

## Status

Implemented the login, setup, password-change, and logout UI in the feature worktree.

## Changes

- Added `components/AuthForms.tsx` with login/setup modes, required fields, password confirmation, loading state, keyboard-submit support, and generic non-sensitive server errors.
- Added `app/login/page.tsx` and `app/setup/page.tsx`; successful login navigates to `/`, successful setup navigates to `/login`.
- Updated `components/AuthGate.tsx` to route unauthenticated users to the appropriate dedicated page.
- Added AppShell settings actions for password change and logout. Password change success logs out the current session and navigates to `/login`.
- Added theme-aware responsive authentication and settings styles in `app/globals.css`.
- Added static behavior tests in `components/AuthForms.test.mjs` covering required fields, confirmation, generic errors, navigation contracts, and storage/cookie safety constraints.

## Security Notes

- The UI does not read cookies, write credentials to storage, generate an initialization token, or render submitted secret values.
- Password and token validation remains server-side; client-side confirmation only prevents an avoidable submission.
- Server response bodies are not rendered. Statuses map to generic messages, with rate-limit feedback retained.

## Verification

- `node --test components/AuthForms.test.mjs`: PASS, 3/3.
- `git diff --check`: PASS.
- `node_modules/.bin/tsc --noEmit`: NOT RUN, `node_modules` is absent in this worktree.
- `npm run lint`: NOT RUN successfully for the same dependency absence; the repository wrapper produced no usable ESLint output.

## Concerns

- Typecheck and lint need to be rerun after dependencies are available.
- Browser-level Playwright acceptance was not available; the static behavior tests are the requested fallback for this repository.

## Reviewer Follow-up

- 修复改密后的退出流程：改密成功后无论 logout 请求成功或失败，均在 `finally` 中导航到 `/login`。
- 认证失败统一使用通用文案，移除 UI 中暴露“当前密码错误”等具体失败类型。
- 将 `components/AuthForms.test.mjs` 改为可执行行为测试，覆盖 login/setup payload、确认密码短路、HTTP 失败回调和成功回调。
- 将认证提交逻辑抽取到 `lib/auth-form.ts`，补齐涉及导出的中文 JSDoc，并将 `AuthGate` 状态请求函数放入 effect 以修正依赖问题。

## Reviewer Verification

- RED: 首次运行行为测试因 `lib/auth-form.ts` 尚不存在而失败。
- GREEN: `node --test components/AuthForms.test.mjs` PASS，6/6。
- `node --test lib/pi-web-auth.test.mjs` PASS，37/37。
- `git diff --check` PASS。
- TypeScript typecheck 未运行：本 worktree 没有 `node_modules/.bin/tsc`。

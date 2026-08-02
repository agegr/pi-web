// node-pty 为可选原生依赖；本仓库不强制安装，pty-runner 运行时动态 import 并优雅降级。
// 此处提供最小类型声明，仅覆盖 pty-runner 实际使用的 spawn API，避免编译期找不到模块。
declare module "node-pty" {
  export interface IPty {
    pid?: number;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (code: number, signal?: string) => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
  }

  export function spawn(
    file: string,
    args: string[],
    options: {
      cwd?: string;
      cols?: number;
      rows?: number;
      env?: NodeJS.ProcessEnv;
    },
  ): IPty;
}

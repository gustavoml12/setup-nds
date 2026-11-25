// O tsconfig gerado pelo Orca só enxerga os tipos do próprio Orca: não há @types/node.
// `process` existe no worker Node e no runner de testes, mas não está declarado em lugar nenhum.
// A leitura é defensiva em src/platform.ts: se o global faltar, cai no path do workspace.
declare const process: { platform: string; cwd(): string; env: Record<string, string | undefined> }

// Só os testes de casca (`*.shell.test.ts`) usam isto: rodam `sh -n` / `sh -c` de verdade.
declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: string[],
    options?: { encoding?: 'utf8'; env?: Record<string, string | undefined>; input?: string }
  ): { status: number | null; stdout: string; stderr: string; error?: Error }
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function existsSync(path: string): boolean
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}
declare module 'node:os' {
  export function tmpdir(): string
}

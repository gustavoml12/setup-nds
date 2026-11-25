// O tsconfig gerado pelo Orca só enxerga os tipos do próprio Orca: não há @types/node.
// `process` existe no worker Node e no runner de testes, mas não está declarado em lugar nenhum.
// A leitura é defensiva em src/platform.ts: se o global faltar, cai no path do workspace.
declare const process: { platform: string; cwd(): string }

export type Platform = 'win32' | 'darwin' | 'linux'
/** O bloco de comando que o SO entende. darwin e linux são o mesmo bloco: o `fix` prova o
 *  gerenciador de pacotes (brew → apt-get → dnf) em vez de confiar no rótulo. */
export type CmdPlatform = 'win32' | 'posix'

export function cmdPlatform(platform: Platform): CmdPlatform {
  return platform === 'win32' ? 'win32' : 'posix'
}

export function platformFromNode(value: string | undefined): Platform | null {
  if (value === 'win32' || value === 'darwin' || value === 'linux') return value
  return null
}

export function platformFromPath(path: string): Platform | null {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')) return 'win32'
  if (path.startsWith('/')) return 'linux'
  return null
}

/** `process.platform` é o caminho certo; o path do workspace é o fallback. Os dois falham →
 *  null, e quem chama responde com erro em vez de escolher um SO ao acaso. */
export function detectPlatform(workspacePath?: string): Platform | null {
  let node: string | undefined
  try {
    node = process.platform
  } catch {
    node = undefined
  }
  return platformFromNode(node) ?? (workspacePath ? platformFromPath(workspacePath) : null)
}

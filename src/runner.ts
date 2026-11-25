export type Host = {
  call(method: string, params: Record<string, unknown>): Promise<unknown>
}

/** `fix` fica abaixo do teto de 120 000 ms do `plugin.request`; o painel rechama até o
 *  marcador aparecer (ver Refinamento 2). */
export const DEADLINES = {
  audit: 20_000,
  fix: 100_000,
  issues: 30_000,
  clone: 100_000
} as const

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Índice da última linha do output que é exatamente `marker`, ou -1.
 *
 * O PTY ecoa a linha que `terminal.create` recebeu, e essa linha carrega o marcador na
 * forma quebrada (`AUDIT""_DONE`). Exigir a linha inteira deixa o eco incapaz de casar:
 * o eco é uma linha longa com muito texto à volta. Uma linha de saída real é o marcador
 * sozinho.
 */
export function markerLine(output: string, marker: string): number {
  const lines = output.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === marker) return i
  }
  return -1
}

export function hasMarker(output: string, markers: readonly string[]): boolean {
  return markers.some((marker) => markerLine(output, marker) !== -1)
}

export async function closeQuietly(host: Host, terminalId?: string): Promise<void> {
  if (!terminalId) return
  try {
    await host.call('terminal.close', { terminalId })
  } catch {
    /* já foi fechado ou nunca existiu: fechar de novo não é erro */
  }
}

/**
 * Roda `command` num terminal efêmero do workspace focado e devolve a saída quando um dos
 * `markers` aparecer como linha inteira, ou quando o prazo passar. O terminal é fechado no
 * `finally` — inclusive quando o `create` é recusado, porque nesse caso não há o que fechar.
 */
export async function runStep(
  host: Host,
  title: string,
  command: string,
  markers: readonly string[],
  deadlineMs: number
): Promise<string> {
  let terminalId: string | undefined
  try {
    const context = (await host.call('workspace.readContext', {})) as { workspaceId?: string } | null
    const workspaceId = context?.workspaceId
    if (!workspaceId) throw new Error('nenhum workspace aberto')
    const created = (await host.call('terminal.create', {
      workspaceId,
      title,
      command
    })) as { terminalId: string }
    terminalId = created.terminalId

    const deadline = Date.now() + deadlineMs
    for (;;) {
      const read = (await host.call('terminal.read', {
        terminalId,
        maxLines: 200
      })) as { lines: string[] }
      const output = read.lines.join('\n')
      if (hasMarker(output, markers) || Date.now() >= deadline) return output
      await sleep(400)
    }
  } finally {
    await closeQuietly(host, terminalId)
  }
}

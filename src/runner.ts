export type Host = {
  call(method: string, params: Record<string, unknown>): Promise<unknown>
}

/** `audit`/`issues`/`clone` rodam dentro de uma requisição só (teto de 120 000 ms do
 *  `plugin.request`). `fix` NÃO: o painel rechama `setup.fix` a cada 1,5 s, então o prazo é
 *  do terminal, não da requisição — 300 s cobrem um `apt`/`winget`/`brew` lento, e um
 *  `sudo` esperando senha (o terminal fica aberto para o aluno digitar) não trava pra sempre. */
export const DEADLINES = {
  audit: 20_000,
  fix: 300_000,
  issues: 30_000,
  clone: 100_000
} as const

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { hasMarker, markerLine } from './markers'
import { hasMarker } from './markers'

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

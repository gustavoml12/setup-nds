// Helpers puros de marcador: nenhuma chamada ao host. O painel importa isto (via steps.ts),
// e por isso nada aqui pode puxar `runner.ts` (terminal.create/read/close) para o grafo estático.
import type { CmdPlatform } from './platform'

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

/** Quebra o marcador na fonte, nas duas cascas: o eco carrega o texto com as aspas / com o
 *  `+`, a saída carrega o marcador limpo. */
export function markerEcho(marker: string, platform: CmdPlatform): string {
  const head = marker.replace(/_.*$/, '')
  const tail = marker.slice(head.length)
  return platform === 'win32'
    ? `Write-Output ('${head}' + '${tail}')`
    : `echo ${head}""${tail}`
}

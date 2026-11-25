import { assert, describe, test } from 'orca/testing'
import { hasMarker, markerLine, runStep, type Host } from './runner'

/** Um host gravador: devolve o que `__reads` manda, na ordem, e registra a ordem das chamadas.
 *  Indexado, não por `shift`: com uma única leitura na fila o `length > 1` nunca casa e o
 *  host devolveria `params` — um objeto sem `.lines`, que quebraria `runStep` com TypeError. */
function recordingHost(results: Record<string, unknown>): Host & { calls: string[] } {
  const calls: string[] = []
  const reads = (results.__reads as { lines: string[] }[] | undefined) ?? []
  let index = 0
  return {
    calls,
    async call(method, params) {
      calls.push(method)
      if (method === 'terminal.read' && index < reads.length) return reads[index++]
      return results[method] ?? params
    }
  }
}

describe('markerLine', () => {
  test('o eco do comando, uma linha longa, nunca casa', () => {
    // O terminal ecoa a linha de origem, que carrega o marcador quebrado.
    const echo = 'tool code VSCODE; echo AUDIT""_DONE'
    assert.equal(markerLine(echo, 'AUDIT_DONE'), -1)
  })

  test('a saída real, uma linha exata, casa — e a última vence', () => {
    const out = ['AUDIT_DONE', 'VSCODE=1', 'AUDIT_DONE'].join('\n')
    assert.equal(markerLine(out, 'AUDIT_DONE'), 2)
  })

  test('espaço sobrando na linha é aceito', () => {
    assert.equal(markerLine('AUDIT_DONE  \n', 'AUDIT_DONE'), 0)
  })
})

describe('hasMarker', () => {
  test('basta um dos marcadores', () => {
    assert.equal(hasMarker('FIXED_DONE', ['AUDIT_DONE', 'FIXED_DONE']), true)
    assert.equal(hasMarker('VSCODE=1', ['AUDIT_DONE']), false)
  })
})

describe('runStep', () => {
  test('cria, lê até o marcador e fecha no finally', async () => {
    const host = recordingHost({
      'workspace.readContext': { workspaceId: 'w1' },
      'terminal.create': { terminalId: 't1' },
      __reads: [{ lines: ['rodando...'], truncated: false }, { lines: ['FIXED_DONE'], truncated: false }],
      'terminal.close': { closed: true }
    })
    const out = await runStep(host, 'setup: fix', 'echo FIXED""_DONE', ['FIXED_DONE'], 5000)
    assert.equal(out, 'FIXED_DONE')
    assert.deepEqual(host.calls, ['workspace.readContext', 'terminal.create', 'terminal.read', 'terminal.read', 'terminal.close'])
  })

  test('sem workspace, lança — e não cria terminal nenhum', async () => {
    const host = recordingHost({ 'workspace.readContext': null })
    await assert.rejects(() => runStep(host, 'x', 'true', ['M'], 1000))
    assert.deepEqual(host.calls, ['workspace.readContext'])
  })

  test('prazo estourado devolve a saída parcial e fecha o terminal', async () => {
    const host = recordingHost({
      'workspace.readContext': { workspaceId: 'w1' },
      'terminal.create': { terminalId: 't1' },
      'terminal.read': { lines: ['ainda rodando'], truncated: false },
      'terminal.close': { closed: true }
    })
    const out = await runStep(host, 'x', 'sleep 999', ['NUNCA'], 600)
    assert.ok(out.includes('ainda rodando'))
    assert.equal(host.calls[host.calls.length - 1], 'terminal.close')
  })

  test('o finally fecha mesmo quando o create recusa', async () => {
    const host: Host & { calls: string[] } = {
      calls: [],
      async call(method) {
        this.calls.push(method)
        if (method === 'terminal.create') throw Object.assign(new Error('negado'), { code: 'capability_denied' })
        if (method === 'workspace.readContext') return { workspaceId: 'w1' }
        return {}
      }
    }
    await assert.rejects(() => runStep(host, 'x', 'true', ['M'], 1000))
    assert.ok(!host.calls.includes('terminal.close'), 'sem terminalId não há o que fechar')
  })
})

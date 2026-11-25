import { assert, describe, mockHost, mountWorker, test } from 'orca/testing'
import { auditCommand } from './steps'
import * as main from './worker'

const CONTEXT = { workspaceId: 'w1', branch: 'main', displayName: 'w1', terminals: [] }
/** `workspaceOf` lê o path por aqui — sem isso, todo handler cairia em noWorkspace. */
/** Formato exigido pelo schema do host: o mockHost rejeita campos faltando. */
const LIST = {
  workspaces: [{ id: 'w1', kind: 'folder', name: 'dev', path: '/home/aluno/dev', branch: null, hostId: null }],
  truncated: false
}
const READY_HOST = {
  'workspace.readContext': CONTEXT,
  'workspace.list': LIST,
  'terminal.close': { closed: true }
}

/** Linhas que o terminal devolve, na ordem em que `terminal.read` as entregar. */
function respondTerminal(host: ReturnType<typeof mockHost>, reads: unknown[]): void {
  let index = 0
  host.respond('terminal.read', () => ({ lines: reads[Math.min(index++, reads.length - 1)] as string[], truncated: false }))
}

describe('setup.audit', () => {
  test('sem workspace → noWorkspace, e nenhum terminal é criado', async () => {
    const host = mockHost({ results: { 'workspace.readContext': null } })
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.audit')) as { noWorkspace?: boolean; steps: unknown[] }
    assert.equal(answer.noWorkspace, true)
    assert.deepEqual(answer.steps, [])
    assert.deepEqual(host.callsOf('terminal.create'), [])
    await tw.deactivate()
  })

  test('erro no host ao listar workspaces → error preenchido e noWorkspace falso/indefinido', async () => {
    const host = mockHost({
      results: {
        'workspace.readContext': CONTEXT,
        'workspace.list': () => {
          throw new Error('falha interna do host ao listar')
        }
      }
    })
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.audit')) as { noWorkspace?: boolean; error?: string }
    assert.equal(answer.noWorkspace, undefined)
    assert.equal(answer.error, 'falha interna do host ao listar')
    await tw.deactivate()
  })

  test('lê a saída da auditoria e fecha o terminal', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    respondTerminal(host, [['VSCODE=1', 'GIT=0', 'AUDIT_DONE']])
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.audit')) as { noWorkspace?: boolean; steps: { id: string; status: string }[] }
    assert.equal(answer.noWorkspace, undefined)
    assert.equal(answer.steps.find((s) => s.id === 'vscode')?.status, 'ok')
    assert.equal(answer.steps.find((s) => s.id === 'git')?.status, 'missing')
    assert.equal(host.callsOf('terminal.close').length, 1)
    await tw.deactivate()
  })

  test('o comando gerado é o do SO detectado', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    respondTerminal(host, [['AUDIT_DONE']])
    const tw = await mountWorker(main, { host })
    await tw.request('setup.audit')
    const create = host.callsOf('terminal.create')[0] as { command: string }
    const expected = auditCommand(process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux')
    assert.equal(create.command, expected)
    await tw.deactivate()
  })
})

describe('setup.fix', () => {
  test('primeira chamada só cria: done=false, sem esperar a instalação inteira', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    respondTerminal(host, [['ainda baixando']])
    const tw = await mountWorker(main, { host })
    const first = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
    assert.equal(first.done, false, 'o pedido não pode esperar 120 s por um winget')
    await tw.deactivate()
  })

  test('a segunda chamada lê o MESMO terminal: marcador chega → done=true, ok=true', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    // A primeira chamada só cria e não lê; a leitura acontece a partir da segunda.
    respondTerminal(host, [['FIXED_DONE']])
    const tw = await mountWorker(main, { host })

    const first = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
    assert.equal(first.done, false, 'a criação não espera a instalação inteira')

    const second = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean; ok: boolean }
    assert.equal(second.done, true)
    assert.equal(second.ok, true)
    assert.equal(host.callsOf('terminal.create').length, 1, 'não cria um terminal novo por chamada')
    await tw.deactivate()
  })

  test('etapa sem fix de shell (glab-auth, clone) responde erro, não tenta rodar', async () => {
    const host = mockHost({ results: { ...READY_HOST } })
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.fix', { stepId: 'clone' })) as { done: boolean; detail: string }
    assert.equal(answer.done, true)
    assert.ok(answer.detail.includes('correção própria'), answer.detail)
    assert.deepEqual(host.callsOf('terminal.create'), [])
    await tw.deactivate()
  })

  test('terminal.read rejeita durante poll → limpa runs, tenta close e responde ok=false', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    const tw = await mountWorker(main, { host })

    // Primeira chamada: inicia e registra terminalId 't9' no runs
    const first = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
    assert.equal(first.done, false)
    assert.equal(host.callsOf('terminal.create').length, 1)

    // Segunda chamada: terminal.read falha (ex: terminal fechado pelo usuário)
    host.respond('terminal.read', () => {
      throw new Error('terminal destroyed')
    })
    const second = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean; ok: boolean; detail: string }
    assert.equal(second.done, true)
    assert.equal(second.ok, false)
    assert.equal(second.detail, 'terminal destroyed')
    assert.equal(host.callsOf('terminal.close').length, 1)

    // Terceira chamada: com runs limpo, deve ser capaz de criar um novo terminal (start)
    host.respond('terminal.read', () => ({ lines: ['ainda baixando'], truncated: false }))
    const third = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
    assert.equal(third.done, false)
    assert.equal(host.callsOf('terminal.create').length, 2, 'novo terminal foi criado após a limpeza do map')
    await tw.deactivate()
  })
})

describe('fila serializada', () => {
  test('a segunda operação só cria terminal depois da primeira fechar', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    const reads: string[][] = [['AUDIT_DONE'], ['FIXED_DONE']]
    let index = 0
    host.respond('terminal.read', () => ({ lines: reads[Math.min(index++, reads.length - 1)], truncated: false }))
    const tw = await mountWorker(main, { host })

    const audit = tw.request('setup.audit')
    const fix = tw.request('setup.fix', { stepId: 'git' })
    await Promise.all([audit, fix])

    const order = host.calls.filter((c) => c.method === 'terminal.create' || c.method === 'terminal.close')
    const closeAt = order.findIndex((c) => c.method === 'terminal.close')
    const secondCreate = order.map((c) => c.method).lastIndexOf('terminal.create')
    assert.ok(closeAt !== -1, 'a primeira operação fechou')
    assert.ok(secondCreate > closeAt, 'o create da segunda vem depois do close da primeira')
    await tw.deactivate()
  })
})

describe('setup.clone', () => {
  test('sem workspace → ok=false, sem tentar nada', async () => {
    const host = mockHost({ results: { 'workspace.readContext': null } })
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.clone')) as { ok: boolean; detail: string }
    assert.equal(answer.ok, false)
    assert.deepEqual(host.callsOf('terminal.create'), [])
    await tw.deactivate()
  })
})

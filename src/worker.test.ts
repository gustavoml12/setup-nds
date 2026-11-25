import { assert, describe, mockHost, mountWorker, test } from 'orca/testing'
import { DEADLINES } from './runner'
import { auditCommand, fixCommand } from './steps'
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

describe('setup.fix: marcadores de falha e prazo', () => {
  const echoOf = (id: 'opencode' | 'git') => fixCommand(id, 'linux') as string

  test('o eco do comando (com NEED_ADMIN quebrado) não derruba um fix que deu certo', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    respondTerminal(host, [[echoOf('opencode'), 'FIXED_DONE']])
    const tw = await mountWorker(main, { host })
    await tw.request('setup.fix', { stepId: 'opencode' })
    const done = (await tw.request('setup.fix', { stepId: 'opencode' })) as { ok: boolean; detail: string }
    assert.equal(done.ok, true)
    assert.equal(done.detail, 'concluído')
    await tw.deactivate()
  })

  test('NEED_ADMIN de verdade, como linha própria, ainda reprova', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    respondTerminal(host, [[echoOf('opencode'), 'NEED_ADMIN', 'FIXED_DONE']])
    const tw = await mountWorker(main, { host })
    await tw.request('setup.fix', { stepId: 'opencode' })
    const done = (await tw.request('setup.fix', { stepId: 'opencode' })) as { ok: boolean; detail: string }
    assert.equal(done.ok, false)
    assert.ok(done.detail.includes('administrador'))
    await tw.deactivate()
  })

  test('NO_PKG_MANAGER de verdade reprova', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    respondTerminal(host, [['NO_PKG_MANAGER', 'FIXED_DONE']])
    const tw = await mountWorker(main, { host })
    await tw.request('setup.fix', { stepId: 'git' })
    const done = (await tw.request('setup.fix', { stepId: 'git' })) as { ok: boolean }
    assert.equal(done.ok, false)
    await tw.deactivate()
  })

  test('prazo estourado: fecha o terminal, limpa runs e devolve done com ok=false', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't9' } } })
    respondTerminal(host, [['[sudo] password for aluno:']])
    const tw = await mountWorker(main, { host })
    const realNow = Date.now
    let now = realNow()
    Date.now = () => now
    try {
      const first = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
      assert.equal(first.done, false)
      now += DEADLINES.fix - 1_000
      const waiting = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
      assert.equal(waiting.done, false, 'dentro do prazo continua esperando')
      now += 2_000
      const expired = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean; ok: boolean; detail: string }
      assert.equal(expired.done, true)
      assert.equal(expired.ok, false)
      assert.equal(expired.detail, 'tempo esgotado — veja o terminal do Orca')
      assert.equal(host.callsOf('terminal.close').length, 1)
      const again = (await tw.request('setup.fix', { stepId: 'git' })) as { done: boolean }
      assert.equal(again.done, false, 'runs foi limpo: um novo start nasce')
      assert.equal(host.callsOf('terminal.create').length, 2)
    } finally {
      Date.now = realNow
    }
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

  const ISSUES_OUT = [
    JSON.stringify([
      { web_url: 'https://nds.unirv.edu.br/gitlab/g/a/-/issues/1', iid: 1, title: 'A' },
      { web_url: 'https://nds.unirv.edu.br/gitlab/g/b/-/issues/2', iid: 2, title: 'B' }
    ]),
    'ISSUES_DONE'
  ]

  test('um repo falho não marca os outros: veredito por linha CLONE_OK_n / CLONE_ERR_n', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    // Primeira leitura: issues. Segunda: clone — o eco longo está no buffer e cita os dois caminhos.
    respondTerminal(host, [ISSUES_OUT, ['git clone g/a g/b', 'fatal: destination path \'b\' already exists', 'CLONE_OK_0', 'CLONE_ERR_1', 'CLONE_DONE']])
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.clone')) as { ok: boolean; cloned: string[]; failed: { path: string }[] }
    assert.equal(answer.ok, false)
    assert.deepEqual(answer.cloned, ['g/a'])
    assert.deepEqual(answer.failed.map((f) => f.path), ['g/b'])
    await tw.deactivate()
  })

  test('todos OK → ok=true', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    respondTerminal(host, [ISSUES_OUT, ['CLONE_OK_0', 'CLONE_OK_1', 'CLONE_DONE']])
    const tw = await mountWorker(main, { host })
    const answer = (await tw.request('setup.clone')) as { ok: boolean; cloned: string[] }
    assert.equal(answer.ok, true)
    assert.deepEqual(answer.cloned, ['g/a', 'g/b'])
    await tw.deactivate()
  })
})

describe('prazo da auditoria', () => {
  test('auditoria sem marcador responde timedOut, não apenas unknown', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    respondTerminal(host, [['CLAUDE=1']])
    const tw = await mountWorker(main, { host })
    const realNow = Date.now
    let now = realNow()
    Date.now = () => (now += 50_000)
    try {
      const answer = (await tw.request('setup.audit')) as { timedOut?: boolean; steps: { status: string }[] }
      assert.equal(answer.timedOut, true)
      assert.ok(answer.steps.length > 0, 'a UI ainda desenha a checklist')
      assert.ok(answer.steps.every((step) => step.status === 'unknown'))
      assert.ok(tw.logs.some((line) => line.includes('estourou o prazo sem marcador') && line.includes('CLAUDE=1')))
    } finally {
      Date.now = realNow
    }
    await tw.deactivate()
  })

  test('DEADLINES.audit tem folga sob o teto de 120s do plugin.request', () => {
    assert.ok(DEADLINES.audit > 90_000, 'audit > 90s')
    assert.ok(DEADLINES.audit < 120_000, 'audit < 120s')
    assert.ok(DEADLINES.clone < 120_000, 'clone < 120s')
  })
})

/** Varre a resposta como o schema JSON do Orca: `undefined` em qualquer ponto é erro. */
function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined) assert.fail(`valor undefined em ${path}`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertNoUndefined(item, `${path}.${key}`)
  }
}

describe('respostas JSON-válidas (sem undefined)', () => {
  test('resposta de setup.audit não contém undefined, mesmo com steps em ok', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    respondTerminal(host, [['VSCODE=1', 'GIT=0', 'AUDIT_DONE']])
    const tw = await mountWorker(main, { host })
    const answer = await tw.request('setup.audit')
    assertNoUndefined(answer, 'resposta')
    await tw.deactivate()
  })

  test('nenhuma resposta de handler contém undefined', async () => {
    const host = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    respondTerminal(host, [['VSCODE=1', 'GIT=0', 'AUDIT_DONE']])
    const tw = await mountWorker(main, { host })
    assertNoUndefined(await tw.request('setup.audit'), 'setup.audit')
    assertNoUndefined(await tw.request('setup.fix', { stepId: 'git' }), 'setup.fix[start]')
    assertNoUndefined(await tw.request('setup.fix', { stepId: 'clone' }), 'setup.fix[clone]')
    assertNoUndefined(await tw.request('setup.gitlab'), 'setup.gitlab')
    await tw.deactivate()

    const host2 = mockHost({ results: { ...READY_HOST, 'terminal.create': { terminalId: 't1' } } })
    const issuesOut = [
      JSON.stringify([{ web_url: 'https://nds.unirv.edu.br/gitlab/g/a/-/issues/1', iid: 1, title: 'A' }]),
      'ISSUES_DONE'
    ]
    respondTerminal(host2, [issuesOut, ['CLONE_OK_0', 'CLONE_DONE']])
    const tw2 = await mountWorker(main, { host: host2 })
    assertNoUndefined(await tw2.request('setup.clone'), 'setup.clone')
    await tw2.deactivate()
  })
})

import { assert, mockHost, mount, test } from 'orca/testing'
import type { AuditAnswer } from './protocol'
import * as panel from './panel'

const READY: AuditAnswer = {
  platform: 'darwin',
  steps: [
    { id: 'vscode', title: 'VS Code', group: 'ferramentas', status: 'ok' },
    { id: 'git', title: 'Git', group: 'ferramentas', status: 'missing' },
    { id: 'claude', title: 'Claude Code', group: 'agentes', status: 'skip' }
  ]
}

test('sem workspace: instrução no lugar de um shell, e nenhum botão de conserto', async () => {
  const host = mockHost({ requests: { 'setup.audit': () => ({ platform: null, steps: [], noWorkspace: true }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /Abra uma pasta no Orca/ }), 'instrução visível')
  assert.equal(view.find({ text: /Consertar/ }), null, 'sem etapa faltante não há o que consertar')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('checklist desenha cada etapa; só a missing ganha botão de conserto', async () => {
  const host = mockHost({ requests: { 'setup.audit': () => READY } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /VS Code/ }))
  assert.ok(view.find({ text: /Claude Code/ }), 'etapa skip aparece, marcada como não usada')
  assert.ok(view.find({ text: /Consertar tudo \(1\)/ }), 'uma etapa faltando ⇒ contador 1')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('falha do worker vira mensagem e botão de repetir, nunca exceção no frame', async () => {
  const host = mockHost({
    requests: {
      'setup.audit': () => {
        throw new Error('boom')
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /Tentar de novo/ }), 'estado de erro com saída')
  assert.ok(view.find({ text: /boom/ }), 'a mensagem original chega ao usuário')
  assert.deepEqual(view.errors, [], 'o frame não viu exceção')
  await view.unmount()
})

test('Finding 1: fix bem-sucedido dispara re-auditoria e atualiza checklist', async () => {
  let auditCount = 0
  const host = mockHost({
    requests: {
      'setup.audit': () => {
        auditCount++
        if (auditCount === 1) {
          return READY
        }
        return {
          platform: 'darwin',
          steps: [
            { id: 'vscode', title: 'VS Code', group: 'ferramentas', status: 'ok' },
            { id: 'git', title: 'Git', group: 'ferramentas', status: 'ok' },
            { id: 'claude', title: 'Claude Code', group: 'agentes', status: 'skip' }
          ]
        }
      },
      'setup.fix': () => ({ done: true, ok: true, detail: 'concluído' })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /✘ Git — falta/ }), 'antes do fix, git está missing')

  const gitRow = view.find({ text: /Git/ })
  assert.ok(gitRow, 'linha do git encontrada')
  await view.press(gitRow)

  assert.equal(auditCount, 2, 'audit foi chamado novamente após fix concluído')
  assert.ok(view.find({ text: /✔ Git — ok/ }), 'após fix e re-audit, git aparece como ok')
  assert.equal(view.find({ text: /✘ Git — falta/ }), null, 'estado missing desapareceu')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Finding 2: Consertar tudo interrompe o loop em caso de falha', async () => {
  let auditCount = 0
  const host = mockHost({
    requests: {
      'setup.audit': () => {
        auditCount++
        return {
          platform: 'darwin',
          steps: [
            { id: 'vscode', title: 'VS Code', group: 'ferramentas', status: 'missing' },
            { id: 'git', title: 'Git', group: 'ferramentas', status: 'missing' }
          ]
        }
      },
      'setup.fix': () => ({ done: true, ok: false, detail: 'falha intencional' })
    }
  })
  const view = await mount(panel, { host })
  assert.equal(auditCount, 1, 'primeiro audit montado')

  const fixAll = view.find({ text: /Consertar tudo \(2\)/ })
  assert.ok(fixAll, 'botão Consertar tudo encontrado')
  await view.press(fixAll)

  assert.equal(auditCount, 1, 'audit NÃO foi chamado novamente após a falha no fix')
  assert.ok(view.find({ text: /falha intencional/ }), 'mensagem de erro visível')
  assert.ok(view.find({ text: /Tentar de novo/ }), 'botão Tentar de novo preservado e visível')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('Finding 3: no_workspace renderiza botão Verificar e nenhum botão Consertar', async () => {
  const host = mockHost({ requests: { 'setup.audit': () => ({ platform: null, steps: [], noWorkspace: true }) } })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /Abra uma pasta no Orca/ }), 'EmptyState presente')
  assert.ok(view.find({ text: 'Verificar' }), 'botão Verificar presente abaixo do EmptyState')
  assert.equal(view.find({ text: /Consertar/ }), null, 'nenhum botão Consertar presente')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

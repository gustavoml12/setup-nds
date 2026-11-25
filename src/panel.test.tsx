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

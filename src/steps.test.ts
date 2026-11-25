import { assert, describe, test } from 'orca/testing'
import { auditCommand, fixCommand, parseAudit, AUDIT_MARKER, FIX_MARKER, STEPS } from './steps'

describe('auditCommand', () => {
  test('windows e posix nunca são o mesmo texto', () => {
    assert.notEqual(auditCommand('win32'), auditCommand('darwin'))
    assert.notEqual(auditCommand('win32'), auditCommand('linux'))
  })

  test('darwin e linux caem no mesmo bloco: o fix prova o gerenciador de pacotes', () => {
    assert.equal(auditCommand('darwin'), auditCommand('linux'))
  })

  test('o marcador vai quebrado na fonte, para o eco não casar', () => {
    assert.ok(auditCommand('darwin').includes('AUDIT""_DONE'))
    assert.ok(auditCommand('win32').includes("('AUDIT' + '_DONE')"))
    assert.ok(!auditCommand('darwin').split('\n').some((l) => l.trim() === 'AUDIT_DONE'))
  })
})

describe('parseAudit', () => {
  const echo = auditCommand('darwin').split('\n')[0] ?? auditCommand('darwin')

  test('o eco do comando, que contém TODOS os literais, é ignorado', () => {
    const output = [echo, 'VSCODE=1', 'GIT=0', AUDIT_MARKER].join('\n')
    const parsed = parseAudit(output)
    assert.equal(parsed.get('VSCODE'), 'ok')
    assert.equal(parsed.get('GIT'), 'missing')
  })

  test('A vira skip, U vira unknown, 1 vira ok, 0 vira missing', () => {
    const output = ['CLAUDE=A', 'GEMINI=U', 'NODE=1', 'GIT=0', AUDIT_MARKER].join('\n')
    const parsed = parseAudit(output)
    assert.equal(parsed.get('CLAUDE'), 'skip')
    assert.equal(parsed.get('GEMINI'), 'unknown')
    assert.equal(parsed.get('NODE'), 'ok')
    assert.equal(parsed.get('GIT'), 'missing')
  })

  test('linha truncada pelo eco não vira resposta: some do mapa', () => {
    const output = ['VSCODE=1 lixo que o eco deixou', 'GIT=0', AUDIT_MARKER].join('\n')
    const parsed = parseAudit(output)
    assert.equal(parsed.has('VSCODE'), false)
    assert.equal(parsed.get('GIT'), 'missing')
  })

  test('sem o marcador, nada é confiável: mapa vazio', () => {
    assert.equal(parseAudit('VSCODE=1\nGIT=0').size, 0)
  })

  test('a última ocorrência vence, porque o eco vem primeiro', () => {
    const output = ['VSCODE=0', 'VSCODE=1', AUDIT_MARKER].join('\n')
    assert.equal(parseAudit(output).get('VSCODE'), 'ok')
  })
})

describe('fixCommand', () => {
  test('glab-auth e clone não têm fix de shell: são handlers próprios', () => {
    assert.equal(fixCommand('glab-auth', 'darwin'), null)
    assert.equal(fixCommand('clone', 'darwin'), null)
    assert.equal(fixCommand('glab-auth', 'win32'), null)
  })

  test('toda etapa com fix termina no marcador quebrado', () => {
    for (const step of STEPS) {
      for (const platform of ['win32', 'darwin'] as const) {
        const command = fixCommand(step.id, platform)
        if (command === null) continue
        assert.ok(
          command.includes('FIXED""_DONE') || command.includes("('FIXED' + '_DONE')"),
          `${step.id}/${platform} sem marcador`
        )
      }
    }
  })

  test('winget sempre leva as flags de acordo, senão trava esperando Enter', () => {
    const vscode = fixCommand('vscode', 'win32') ?? ''
    assert.ok(vscode.includes('--accept-package-agreements'))
    assert.ok(vscode.includes('--accept-source-agreements'))
  })
})

describe('catálogo', () => {
  test('ids únicos e presentes', () => {
    const ids = STEPS.map((s) => s.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ['vscode', 'git', 'node', 'opencode', 'oc-plugins', 'glab', 'glab-auth', 'clone'] as const) {
      assert.ok(ids.includes(id), `falta ${id}`)
    }
  })

  test('todas as etapas têm checagem nos dois blocos', () => {
    for (const step of STEPS) {
      assert.ok(step.check.win32.length > 0, `${step.id} sem check win32`)
      assert.ok(step.check.posix.length > 0, `${step.id} sem check posix`)
    }
  })
})

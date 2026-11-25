import { assert, describe, test } from 'orca/testing'
import {
  GITLAB_BASE,
  cloneCommand,
  dedupePaths,
  issuesCommand,
  parseClone,
  parseIssues,
  projectPathFromWebUrl,
  shellQuote
} from './gitlab'

describe('projectPathFromWebUrl', () => {
  test('tira o prefixo do host (que tem path /gitlab) e o sufixo da issue', () => {
    assert.equal(
      projectPathFromWebUrl(`${GITLAB_BASE}/qualificadas/Clinica-Veterinaria/-/issues/12`),
      'qualificadas/Clinica-Veterinaria'
    )
  })

  test('subgrupos são preservados', () => {
    assert.equal(
      projectPathFromWebUrl(`${GITLAB_BASE}/nds/turmas/2026/proj/-/issues/3`),
      'nds/turmas/2026/proj'
    )
  })

  test('host errado ou URL sem issue → null', () => {
    assert.equal(projectPathFromWebUrl('https://gitlab.com/a/b/-/issues/1'), null)
    assert.equal(projectPathFromWebUrl(`${GITLAB_BASE}/a/b`), null)
    assert.equal(projectPathFromWebUrl('não é url'), null)
  })
})

describe('parseIssues', () => {
  test('lê o JSON compactado de uma linha só', () => {
    const payload = JSON.stringify([
      { web_url: `${GITLAB_BASE}/g/p/-/issues/1`, iid: 1, title: 'Tarefa' },
      { web_url: `${GITLAB_BASE}/g/q/-/issues/2`, iid: 2, title: 'Outra' }
    ])
    const { issues } = parseIssues([payload, 'ISSUES_DONE'].join('\n'))
    assert.deepEqual(issues.map((i) => i.path), ['g/p', 'g/q'])
    assert.deepEqual(issues.map((i) => i.number), [1, 2])
  })

  test('a cabeça cortada do array é reconstruída a partir do primeiro objeto', () => {
    // O terminal.read devolve só as 200 linhas mais novas: o `[` inicial já não existe.
    const full = JSON.stringify([
      { web_url: `${GITLAB_BASE}/g/cortada/-/issues/9`, iid: 9, title: 'perdida' },
      { web_url: `${GITLAB_BASE}/g/completa/-/issues/10`, iid: 10, title: 'inteira' }
    ])
    // Corta DENTRO do primeiro objeto, mantendo a chave inicial: ele fica incompleto e o
    // parser tem que pulá-lo. `full.slice(full.indexOf('{'))` NÃO corta nada — o objeto
    // sai inteiro e os dois seriam lidos, mascarando o defeito.
    const first = full.indexOf('{')
    const second = full.indexOf('{', first + 1)
    const cut = full.slice(first, first + 30) + full.slice(second)
    const { issues } = parseIssues([cut, 'ISSUES_DONE'].join('\n'))
    assert.deepEqual(issues.map((i) => i.path), ['g/completa'])
    assert.ok(issues.every((i) => i.title !== ''), 'nada é inventado')
  })

  test('o eco do comando, que carrega os literais, não vira issue', () => {
    const echo = issuesCommand('darwin')
    const { issues } = parseIssues([echo, 'ISSUES_DONE'].join('\n'))
    assert.deepEqual(issues, [])
  })

  test('sem usuário logado → error específico, nunca throw', () => {
    const { issues, error } = parseIssues(['NO_USER', 'ISSUES_DONE'].join('\n'))
    assert.deepEqual(issues, [])
    assert.equal(error, 'não consegui identificar seu usuário no GitLab')
  })
})

describe('issuesCommand', () => {
  test('win32 usa sentinela de concatenação e define GITLAB_HOST', () => {
    const cmd = issuesCommand('win32')
    assert.ok(cmd.includes("('NO' + '_USER')"))
    assert.ok(!cmd.includes('"NO""_USER"'))
    assert.ok(cmd.includes('$env:GITLAB_HOST'))
    assert.ok(cmd.includes('nds.unirv.edu.br/gitlab'))
  })

  test('posix define GITLAB_HOST antes de ambas as chamadas glab api', () => {
    const cmd = issuesCommand('darwin')
    assert.ok(cmd.includes('GITLAB_HOST=nds.unirv.edu.br/gitlab glab api user'))
    assert.ok(cmd.includes('GITLAB_HOST=nds.unirv.edu.br/gitlab glab api "issues?'))
    assert.ok(cmd.includes('echo NO""_USER'))
  })

  test('nenhum comando win32 usa operador de cadeia do PowerShell 7', () => {
    const winIssues = issuesCommand('win32')
    const winClone = cloneCommand(['g/a'], 'C:\\dev', 'win32')
    for (const cmd of [winIssues, winClone]) {
      assert.ok(!cmd.includes('&&'), `win32 tem && em ${cmd}`)
      assert.ok(!cmd.includes('||'), `win32 tem || em ${cmd}`)
    }
  })
})

describe('dedupePaths', () => {
  test('projetos repetidos por várias issues viram um clone só, na ordem da primeira vista', () => {
    const rows = [
      { path: 'g/a', number: 1, title: '', url: '' },
      { path: 'g/b', number: 2, title: '', url: '' },
      { path: 'g/a', number: 3, title: '', url: '' }
    ]
    assert.deepEqual(dedupePaths(rows), ['g/a', 'g/b'])
  })
})

describe('cloneCommand', () => {
  test('só clona o que ainda não existe e termina no marcador', () => {
    const command = cloneCommand(['g/a', 'g/b'], '/home/aluno/dev', 'darwin')
    // shellQuote em POSIX usa aspas simples — é o que escapa apóstrofos direito.
    assert.ok(command.includes("-d 'a'"), 'checa a pasta do último segmento')
    assert.ok(command.includes("git clone -q 'https://nds.unirv.edu.br/gitlab/g/a.git' 'a'"), 'destino explícito')
    assert.ok(command.includes('https://nds.unirv.edu.br/gitlab/g/a.git'))
    assert.ok(command.includes('CLONE""_DONE'))
  })

  test('sem repos, não chama git nenhum', () => {
    const command = cloneCommand([], '/home/aluno/dev', 'darwin')
    assert.ok(!command.includes('git clone'))
    assert.ok(command.includes('CLONE""_DONE'))
  })

  test('windows usa barra invertida e aspas simples do PowerShell', () => {
    const command = cloneCommand(['g/a'], "C:\\Users\\aluno\\dev", 'win32')
    assert.ok(command.includes("'C:\\Users\\aluno\\dev'"))
    assert.ok(command.includes("('CLONE' + '_DONE')"))
  })
})

describe('marcadores por repositório', () => {
  test('quebrados na fonte nos dois dialetos: o eco nunca casa', () => {
    const posix = cloneCommand(['g/a', 'g/b'], '/w', 'darwin')
    const win = cloneCommand(['g/a', 'g/b'], 'C:\\w', 'win32')
    for (const marker of ['CLONE_OK_0', 'CLONE_ERR_0', 'CLONE_OK_1', 'CLONE_ERR_1']) {
      assert.ok(!posix.includes(marker), `${marker} inteiro na fonte POSIX`)
      assert.ok(!win.includes(marker), `${marker} inteiro na fonte PowerShell`)
    }
    assert.ok(posix.includes('CLONE""_OK_0') && posix.includes('CLONE""_ERR_1'))
    assert.ok(win.includes("('CLONE' + '_OK_0')") && win.includes("('CLONE' + '_ERR_1')"))
    assert.ok(!win.includes('&&') && !win.includes('||'))
  })

  test('parseClone: um veredito por repo; o eco não conta; sem resposta é falha', () => {
    const paths = ['g/a', 'g/b', 'g/c']
    const echo = cloneCommand(paths, '/w', 'darwin')
    const out = [echo, 'fatal: algo', 'CLONE_OK_0', 'CLONE_ERR_1', 'CLONE_DONE'].join('\n')
    const verdict = parseClone(out, paths)
    assert.deepEqual(verdict.cloned, ['g/a'])
    assert.deepEqual(verdict.failed.map((f) => f.path), ['g/b', 'g/c'])
    assert.deepEqual(parseClone(echo, paths).cloned, [], 'só o eco: nada é sucesso')
  })
})

describe('shellQuote', () => {
  test('aspas simples escapadas nos dois dialetos', () => {
    assert.equal(shellQuote("it's", 'posix'), `'it'\\''s'`)
    assert.equal(shellQuote("it's", 'win32'), `'it''s'`)
  })
})

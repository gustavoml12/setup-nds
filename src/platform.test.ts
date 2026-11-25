import { assert, describe, test } from 'orca/testing'
import { cmdPlatform, detectPlatform, platformFromNode, platformFromPath } from './platform'

describe('platformFromNode', () => {
  test('reconhece os três valores que o Node reporta', () => {
    assert.equal(platformFromNode('win32'), 'win32')
    assert.equal(platformFromNode('darwin'), 'darwin')
    assert.equal(platformFromNode('linux'), 'linux')
  })

  test('qualquer outra coisa é null, nunca um palpite', () => {
    assert.equal(platformFromNode('freebsd'), null)
    assert.equal(platformFromNode(undefined), null)
  })
})

describe('platformFromPath', () => {
  test('drive letter é Windows', () => {
    assert.equal(platformFromPath('C:\\Users\\aluno\\dev'), 'win32')
    assert.equal(platformFromPath('D:/projetos'), 'win32')
    assert.equal(platformFromPath('\\\\wsl$\\Ubuntu\\home'), 'win32')
  })

  test('barra inicial é POSIX, mas o flavour não se sabe', () => {
    assert.equal(platformFromPath('/home/aluno/dev'), 'linux')
    assert.equal(platformFromPath('/Users/aluno/dev'), 'linux')
  })

  test('caminho relativo não diz nada', () => {
    assert.equal(platformFromPath('dev/projetos'), null)
    assert.equal(platformFromPath(''), null)
  })
})

describe('cmdPlatform', () => {
  test('win32 é win32; darwin e linux caem no mesmo bloco posix', () => {
    assert.equal(cmdPlatform('win32'), 'win32')
    assert.equal(cmdPlatform('darwin'), 'posix')
    assert.equal(cmdPlatform('linux'), 'posix')
  })
})

describe('detectPlatform', () => {
  test('process.platform vence, mesmo com um path contraditório', () => {
    assert.equal(detectPlatform('/home/aluno'), process.platform === 'win32' ? 'win32' : platformFromNode(process.platform))
  })

  test('sem process.platform, o path decide', () => {
    assert.equal(platformFromNode(undefined), null)
    assert.equal(platformFromPath('C:\\x'), 'win32')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUnifiedUserModule } from '../src/core/modules/UnifiedUserModule'
import { ModuleRegistry, MODULE_NAMES } from '../src/core/modules/ModuleRegistry'
import { fetchClient } from '../src/utils/fetchClient'

vi.mock('../src/core/composables/useI18n', () => ({
  useAppI18n: () => ({ t: (key: string) => key }),
}))

const user = (id = 'first') => ({ id, username: id, email: `${id}@example.com`, balance: '0' })
const deferred = () => {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function createModule() {
  const registry = new ModuleRegistry()
  const messages = { messageSuccess: vi.fn(), messageError: vi.fn() }
  registry.register(MODULE_NAMES.USENAIVEUI, messages)
  return { module: createUnifiedUserModule(registry), messages }
}

beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }))
afterEach(() => {
  fetchClient.setUnauthorizedHandler()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('request-scoped authentication state', () => {
  it('ignores a stale initialization 401 after a successful login', async () => {
    const old = deferred()
    let reads = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url === '/api/users/me') return ++reads === 1 ? old.promise : Response.json(user('new'))
        return Response.json({})
      }),
    )
    const { module } = createModule()
    const initialization = module.initialize()
    await module.login('new@example.com', 'Password123')
    old.resolve(Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 }))
    await initialization
    expect(module.currentUser.value?.id).toBe('new')
  })

  it('clears the current session when a current request receives 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/api/users/me'
          ? Response.json(user())
          : Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 }),
      ),
    )
    const { module } = createModule()
    await module.initialize()
    await module.refreshBalance()
    expect(module.currentUser.value).toBeNull()
  })

  it('reports failed logout and keeps the account available for retry', async () => {
    let fail = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url === '/api/users/me') return Response.json(user())
        return fail
          ? Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
          : Response.json({ success: true })
      }),
    )
    const { module, messages } = createModule()
    await module.initialize()
    await expect(module.logout()).rejects.toThrow()
    expect(module.currentUser.value?.id).toBe('first')
    expect(messages.messageSuccess).not.toHaveBeenCalled()
    expect(messages.messageError).toHaveBeenCalledWith('user.logoutFailed')
    fail = false
    await module.logout()
    expect(module.currentUser.value).toBeNull()
    expect(messages.messageSuccess).toHaveBeenCalledWith('user.logoutSuccess')
  })

  it('serializes cookie-mutating auth operations', async () => {
    const signingIn = deferred()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/api/auth/sign-in/email' ? signingIn.promise : Response.json(user()),
      ),
    )
    const { module } = createModule()
    await module.initialize()
    const login = module.login('first@example.com', 'Password123')
    await expect(module.logout()).rejects.toThrow('user.authInProgress')
    signingIn.resolve(Response.json({}))
    await login
  })

  it('does not apply an old redemption response to a newly logged-in account', async () => {
    const redemption = deferred()
    let account = 'first'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url === '/api/activation-code/use') return redemption.promise
        if (url === '/api/users/me') return Response.json(user(account))
        return Response.json({})
      }),
    )
    const { module } = createModule()
    await module.initialize()
    const redeem = module.useActivationCode('TEST-CODE')
    await module.logout()
    account = 'second'
    await module.login('second@example.com', 'Password123')
    redemption.resolve(Response.json({ amount: '1', current_balance: '99', transaction_id: 'old' }))
    await redeem
    expect(module.currentUser.value).toMatchObject({ id: 'second', balance: '0' })
  })

  it.each([
    [400, 'BALANCE_LIMIT_EXCEEDED', false],
    [500, 'INTERNAL_ERROR', true],
    [409, 'IDEMPOTENCY_OPERATION_IN_PROGRESS', true],
  ])('handles redemption retry keys for status %s / %s', async (status, code, reused) => {
    const keys: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (url === '/api/users/me') return Response.json(user())
        keys.push(new Headers(init.headers).get('Idempotency-Key')!)
        return Response.json({ error: code }, { status })
      }),
    )
    const { module } = createModule()
    await module.initialize()
    await expect(module.useActivationCode('TEST-CODE')).rejects.toThrow()
    await expect(module.useActivationCode('TEST-CODE')).rejects.toThrow()
    expect(keys[0] === keys[1]).toBe(reused)
  })
})

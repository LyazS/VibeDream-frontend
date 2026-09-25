import { afterEach, describe, expect, it, vi } from 'vitest'
import { transitionTemplateCatalogService } from '@/core/effect-template/TransitionTemplateCatalogService'

const version = 'a'.repeat(64)

afterEach(() => vi.unstubAllGlobals())

describe('R2 transition catalog', () => {
  it('downloads a searched catalog version without consulting the current pointer', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            catalog_version: version,
            items: [{ id: 'gl-fade', package_version: '1.0.0' }],
          }),
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const catalog = await transitionTemplateCatalogService.getTemplateSummaries(version)
    expect(catalog.items[0].id).toBe('gl-fade')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://assets.example.test/transitions/releases/${version}/catalog.json`,
    )
  })

  it('rejects a package whose identity does not match the requested version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 'gl-fade',
              catalog_version: 'b'.repeat(64),
              package_files: [],
            }),
          ),
      ),
    )
    await expect(
      transitionTemplateCatalogService.downloadTemplatePackage('gl-fade', version),
    ).rejects.toThrow('版本不一致')
  })
})

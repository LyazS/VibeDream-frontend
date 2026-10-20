import { test, expect, type Page } from '@playwright/test'

async function openWorkspace(page: Page) {
  await page.addInitScript(() => {
    // 任何意外的原生目录选择、权限申请都会使测试失败。
    window.showDirectoryPicker = async () => {
      throw new Error('Unexpected directory picker')
    }
    FileSystemHandle.prototype.requestPermission = async () => {
      throw new Error('Unexpected permission request')
    }
    navigator.storage.persist = async () => {
      throw new Error('Unexpected persistence request')
    }
  })
  await page.goto('/')
  await expect(page.locator('.workspace-name')).toHaveText('automation')
  await expect(page.getByTitle('Click to change workspace directory')).toHaveCount(0)
}

async function callHarness<T>(page: Page, method: string, args: unknown[] = []): Promise<T> {
  return page.evaluate(
    async ({ method, args }) => {
      const entry = '/test/browser/opfsHarness.ts'
      const harness = await import(/* @vite-ignore */ entry)
      return harness[method](...args)
    },
    { method, args },
  )
}

test('imports and decodes a real video, then restores the project and attachment after reload', async ({
  page,
}, testInfo) => {
  await openWorkspace(page)
  await page.screenshot({ path: testInfo.outputPath('opfs-workspace.png') })
  const projectId = await callHarness<string>(page, 'createProject')
  await expect.poll(() => callHarness(page, 'projectReady')).toBe(true)
  const imported = await callHarness<{
    mediaId: string
    status: string
    width: number
    height: number
    duration: number
    digest: string
    originalDigest: string
    bytes: number
    pixel: number[]
  }>(page, 'importVideo')
  expect(imported.status).toBe('ready')
  expect([imported.width, imported.height]).toEqual([64, 48])
  expect(imported.duration).toBeCloseTo(1, 1)
  expect(imported.bytes).toBeGreaterThan(100)
  expect(imported.digest).toBe(imported.originalDigest)
  // 有损视频的 YUV/RGB 转换允许少量偏色，检查红色占优即可。
  expect(imported.pixel[0]).toBeGreaterThan(200)
  expect(imported.pixel[1]).toBeLessThan(60)
  expect(imported.pixel[2]).toBeLessThan(60)
  const checkpoint = await callHarness<{ attachmentPath: string; imageDigest: string }>(
    page,
    'writeCheckpoint',
  )
  await page.reload()
  await expect.poll(() => callHarness(page, 'projectReady')).toBe(true)
  await expect(page.locator('.loading-overlay')).toBeHidden()
  expect(await callHarness(page, 'inspectMedia', [imported.mediaId])).toEqual({
    mediaId: imported.mediaId,
    status: imported.status,
    width: imported.width,
    height: imported.height,
    duration: imported.duration,
    digest: imported.digest,
    bytes: imported.bytes,
    pixel: imported.pixel,
  })
  expect(await callHarness(page, 'readCheckpoint', [projectId, checkpoint.attachmentPath])).toEqual(
    {
      imageDigest: checkpoint.imageDigest,
      projects: [projectId],
      marker: 'saved',
      localStorage: 'saved',
    },
  )
  await page.screenshot({ path: testInfo.outputPath('opfs-editor-restored.png') })
})

test('isolates OPFS, Agent IndexedDB and Local Storage between browser contexts', async ({
  page,
  browser,
}) => {
  await openWorkspace(page)
  const projectId = await callHarness<string>(page, 'createProject')
  await expect.poll(() => callHarness(page, 'projectReady')).toBe(true)
  await callHarness(page, 'writeCheckpoint')
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5183', locale: 'en-US' })
  try {
    const otherPage = await other.newPage()
    await openWorkspace(otherPage)
    expect(await callHarness(otherPage, 'isolationState')).toEqual({
      projects: [],
      marker: null,
      localStorage: null,
    })
    expect(await callHarness(page, 'isolationState')).toEqual({
      projects: [projectId],
      marker: 'saved',
      localStorage: 'saved',
    })
  } finally {
    await other.close()
  }
})

test('offers retry after OPFS initialization fails, without asking for a computer directory', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getDirectory = navigator.storage.getDirectory.bind(navigator.storage)
    let first = true
    navigator.storage.getDirectory = async () => {
      if (first) {
        first = false
        throw new DOMException('Storage temporarily unavailable', 'NotAllowedError')
      }
      return getDirectory()
    }
  })
  await page.goto('/')
  await expect(page.getByText('Browser storage is unavailable.', { exact: false })).toBeVisible()
  await expect(page.getByText('Click to Set Directory')).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry access' }).click()
  await expect(page.locator('.workspace-name')).toHaveText('automation')
})

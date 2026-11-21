import { test, expect, type Page } from '@playwright/test'
import type * as Harness from './linkedMediaHarness'

type Method = keyof typeof Harness
async function call<M extends Method>(
  page: Page,
  method: M,
  ...args: Parameters<(typeof Harness)[M]>
): Promise<Awaited<ReturnType<(typeof Harness)[M]>>> {
  return page.evaluate(
    async ({ method, args }) => {
      const entry = '/test/browser/linkedMediaHarness.ts'
      const harness = await import(/* @vite-ignore */ entry)
      return harness[method](...args)
    },
    { method, args },
  )
}

async function project(page: Page) {
  await page.goto('/')
  await expect(page.locator('.workspace-name')).toHaveText('automation')
  const projectId = await call(page, 'createProject')
  await expect.poll(() => call(page, 'projectReady')).toBe(true)
  await expect(page.locator('.loading-overlay')).toBeHidden()
  return projectId
}

async function pick(page: Page, label: string, importLabel = 'Import') {
  const library = page.locator('.media-grid__scroll-viewport')
  await expect(library).toBeVisible()
  const bounds = (await library.boundingBox())!
  await library.click({ button: 'right', position: { x: 12, y: Math.floor(bounds.height) - 20 } })
  await page.getByText(importLabel, { exact: true }).hover()
  await page.getByText(label, { exact: true }).click()
}

async function linkDirectory(page: Page, path: string) {
  await call(page, 'chooseDirectory', path)
  await pick(page, 'Link Folder')
}

async function linkFiles(page: Page, paths: string[]) {
  await call(page, 'chooseFiles', paths)
  await pick(page, 'Link Files')
}

async function openProject(page: Page, id: string) {
  await page.goto(`/editor/${id}`)
  await expect.poll(() => call(page, 'projectReady')).toBe(true)
  await expect(page.locator('.loading-overlay')).toBeHidden()
}

test('keeps the clip and reauthorizes a persisted directory after closing the editor', async ({
  page,
  context,
}, testInfo) => {
  const id = await project(page)
  const a = await call(page, 'seedMedia', 'shoot/card-a/take.webm', 'red')
  const b = await call(page, 'seedMedia', 'shoot/card-b/take.webm', 'green-tone')
  await linkDirectory(page, 'shoot')
  await expect.poll(async () => (await call(page, 'getMedia')).length).toBe(2)
  const assets = await call(page, 'getMedia')
  const first = assets.find((item) => item.directory === 'card-a')!
  const second = assets.find((item) => item.directory === 'card-b')!
  expect(first.source).toMatchObject({
    handleKind: 'directory',
    contentSha256: a,
    relativePath: 'card-a/take.webm',
  })
  expect(second.source).toMatchObject({
    handleKind: 'directory',
    contentSha256: b,
    relativePath: 'card-b/take.webm',
  })
  expect(assets.every((item) => item.thumbnail)).toBe(true)
  expect(await call(page, 'mediaFolderEntries')).toEqual(
    [`${first.id}.meta`, `${second.id}.meta`].sort(),
  )
  expect(await call(page, 'getBindingIds')).toHaveLength(1)
  await call(page, 'renameAndMove', second.id, 'Trimmed take')
  const originalClip = (await call(page, 'attachTrimmedClip', second.id))!
  await call(page, 'removeMedia', first.id)
  expect(await call(page, 'readMedia', second.id)).toBe(b)
  const other = await call(page, 'createOtherLinkedProject', 'shoot')
  await page.close()

  const reopened = await context.newPage()
  await reopened.addInitScript(() => {
    const counts = { query: 0, request: 0 }
    Object.assign(window, { linkedPermissionCounts: counts })
    let granted = false
    const query = FileSystemHandle.prototype.queryPermission
    const request = FileSystemHandle.prototype.requestPermission
    FileSystemHandle.prototype.queryPermission = async function (options) {
      if (this.name !== 'shoot') return query.call(this, options)
      if (options?.mode !== 'read') throw new Error('Expected read permission query')
      counts.query++
      return granted ? 'granted' : 'prompt'
    }
    FileSystemHandle.prototype.requestPermission = async function (options) {
      if (this.name !== 'shoot') return request.call(this, options)
      if (options?.mode !== 'read' || !navigator.userActivation.isActive)
        throw new Error('Expected user-triggered read permission request')
      counts.request++
      granted = true
      return 'granted'
    }
  })
  await openProject(reopened, id)
  const counts = () =>
    reopened.evaluate(
      () =>
        (window as unknown as { linkedPermissionCounts: { query: number; request: number } })
          .linkedPermissionCounts,
    )
  expect(await counts()).toEqual({ query: 1, request: 0 })
  expect(await call(reopened, 'getMedia')).toMatchObject([
    {
      id: second.id,
      name: 'Trimmed take',
      directory: 'root',
      status: 'missing',
      issue: 'permission',
    },
  ])
  expect(await call(reopened, 'getClip')).toMatchObject({
    mediaId: second.id,
    timeRange: originalClip.timeRange,
  })
  await reopened.screenshot({ path: testInfo.outputPath('linked-media-permission.png') })
  await expect(
    reopened.locator('.thumbnail-placeholder[title="Permission required"]'),
  ).toBeVisible()
  await reopened.getByRole('button', { name: 'Reauthorize' }).click()
  await expect.poll(() => call(reopened, 'getClip')).toEqual(originalClip)
  expect(await counts()).toEqual({ query: 2, request: 1 })
  const output = await call(reopened, 'exportAndInspect')
  expect(output.duration).toBeCloseTo(0.7, 1)
  expect(output.pixel[1]).toBeGreaterThan(200)
  expect(output.pixel[0]).toBeLessThan(60)
  expect(output.pixel[2]).toBeLessThan(60)
  expect(output.hasSound).toBe(true)
  await call(reopened, 'removeMedia', second.id)
  expect(await call(reopened, 'getBindingIds')).toEqual([])
  expect(await call(reopened, 'getBindingIds', other)).toHaveLength(1)
  expect(await call(reopened, 'originalDigest', 'shoot/card-a/take.webm')).toBe(a)
  expect(await call(reopened, 'originalDigest', 'shoot/card-b/take.webm')).toBe(b)
})

test('detects changed originals and protects a relink from a pending save', async ({ page }) => {
  const id = await project(page)
  const a = await call(page, 'seedMedia', 'a.webm')
  await call(page, 'seedMedia', 'b.webm')
  await linkFiles(page, ['a.webm', 'b.webm'])
  await expect.poll(() => call(page, 'getBindingIds')).toHaveLength(2)
  await expect.poll(() => call(page, 'getMedia')).toHaveLength(2)
  const [first, second] = await call(page, 'getMedia')
  expect(first.source).toMatchObject({ handleKind: 'file', type: 'linked-file' })
  const clip = await call(page, 'attachTrimmedClip', first.id, 3, 19)
  await call(page, 'changeMedia', first.name, true)
  await call(page, 'changeMedia', second.name, false)
  await openProject(page, id)
  expect((await call(page, 'getMedia')).find((item) => item.id === second.id)).toMatchObject({
    status: 'missing',
    issue: 'changed',
  })
  expect((await call(page, 'getMedia')).find((item) => item.id === first.id)?.issue).toBeUndefined()
  await expect(call(page, 'readMedia', first.id)).rejects.toThrow('原件已变化')
  await page.locator('.status-bar').getByRole('button', { name: 'Export', exact: true }).click()
  await page.locator('.modal-footer').getByRole('button', { name: 'Export', exact: true }).click()
  await expect(
    page.getByText('The following linked media could not be exported', { exact: false }),
  ).toBeVisible()
  await expect(page.getByText(`${first.name} — Original changed`, { exact: false })).toBeVisible()
  await expect(call(page, 'submitIndex', first.id)).rejects.toThrow('原件已变化')
  await call(page, 'seedMedia', 'renamed-original.webm')
  await call(page, 'chooseFiles', ['renamed-original.webm'])
  await call(page, 'holdMetadataWrite')
  const relinking = call(page, 'relink', first.id, 'file')
  await expect.poll(() => call(page, 'waitingForMetadataWrite')).toBe(true)
  const saving = call(page, 'saveMediaMetaAndReleaseWrite', first.id)
  expect(await relinking).toEqual([{ name: first.name }])
  expect(await saving).toBe(false)
  await openProject(page, id)
  expect(await call(page, 'readMedia', first.id)).toBe(a)
  expect(await call(page, 'getClip')).toEqual(clip)
})

test('relinks matching items under a new root and reports missing and changed items separately', async ({
  page,
}) => {
  const projectId = await project(page)
  await call(page, 'seedMedia', 'shoot/one.webm')
  await call(page, 'seedMedia', 'shoot/two.webm')
  await call(page, 'seedMedia', 'shoot/three.webm')
  await linkDirectory(page, 'shoot')
  await expect.poll(() => call(page, 'getMedia')).toHaveLength(3)
  const assets = await call(page, 'getMedia')
  const one = assets.find((item) => item.name === 'one.webm')!
  const two = assets.find((item) => item.name === 'two.webm')!
  const clip = await call(page, 'attachTrimmedClip', one.id, 2, 16)
  await call(page, 'clearBindings')
  await openProject(page, projectId)
  expect((await call(page, 'getMedia')).every(({ issue }) => issue === 'unbound')).toBe(true)
  const digest = await call(page, 'seedMedia', 'new-shoot/one.webm')
  await call(page, 'seedMedia', 'new-shoot/three.webm')
  await call(page, 'changeMedia', 'new-shoot/three.webm', true)
  await call(page, 'chooseDirectory', 'new-shoot')
  await page
    .locator('.directory-item', { hasText: 'shoot' })
    .locator('.item-draggable-area')
    .dblclick()
  await page.locator('.linked-media-status').filter({ hasText: 'Relink required' }).first().click()
  await expect(page.getByText('Recovered 1 asset, 2 failed', { exact: true })).toBeVisible()
  await expect(page.getByText('two.webm — Original missing', { exact: false })).toBeVisible()
  await expect(page.getByText('three.webm — Original changed', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  expect(await call(page, 'getClip')).toEqual(clip)
  expect(await call(page, 'readMedia', one.id)).toBe(digest)
  expect(await call(page, 'getBindingIds')).toHaveLength(1)
  await call(page, 'seedMedia', 'two-renamed.webm')
  await call(page, 'chooseFiles', ['two-renamed.webm'])
  expect(await call(page, 'relink', two.id, 'file')).toEqual([{ name: 'two.webm' }])
  await call(page, 'removeMedia', two.id)
  expect(await call(page, 'readMedia', one.id)).toBe(digest)
})

test('rejects managed entries by handle and skips the protected subtree during enumeration', async ({
  page,
}) => {
  await project(page)
  await call(page, 'seedMedia', 'disk/workspace/projects/another-project/media/copy.webm')
  const original = await call(page, 'seedMedia', 'disk/projects/original.webm')
  await call(page, 'protectWorkspaceProjects', 'disk/workspace')
  await linkFiles(page, ['disk/workspace/projects/another-project/media/copy.webm'])
  await expect(
    page.getByText('Files and folders under managed project storage cannot be linked', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await linkDirectory(page, 'disk/workspace/projects/another-project')
  await expect(
    page.getByText('Files and folders under managed project storage cannot be linked', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await linkDirectory(page, 'disk')
  await expect.poll(() => call(page, 'getMedia')).toMatchObject([{ name: 'original.webm' }])
  expect(await call(page, 'originalDigest', 'disk/projects/original.webm')).toBe(original)
})

test('does not publish an IndexedDB request that is rolled back after success', async ({
  page,
}) => {
  await project(page)
  await call(page, 'seedMedia', 'shot.webm')
  await call(page, 'abortBindingCommit')
  await linkFiles(page, ['shot.webm'])
  await expect(page.getByText('Linked 0 · Failed 1', { exact: false })).toBeVisible()
  await expect(
    page.getByText('shot.webm — Could not link this file.', { exact: false }),
  ).toBeVisible()
  expect(await call(page, 'getMedia')).toEqual([])
  expect(await call(page, 'getBindingIds')).toEqual([])
  expect(await call(page, 'mediaFolderEntries')).toEqual([])
})

test('cleans up a failed initial meta write and localizes import details in Chinese', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('preferred-language', 'zh-CN'))
  await project(page)
  await call(page, 'seedMedia', 'shot.webm')
  await call(page, 'seedMedia', 'unsupported.txt', 'invalid')
  await call(page, 'failMetadataWrite')
  await call(page, 'chooseFiles', ['shot.webm', 'unsupported.txt'])
  await pick(page, '引入文件', '导入')
  await expect(page.getByText('成功 0 · 失败 1', { exact: false })).toBeVisible()
  await expect(page.getByText('shot.webm — 无法引入此文件。', { exact: false })).toBeVisible()
  await expect(
    page.getByText('unsupported.txt — 不支持此文件格式。', { exact: false }),
  ).toBeVisible()
  expect(await call(page, 'getMedia')).toEqual([])
  expect(await call(page, 'getBindingIds')).toEqual([])
  expect(await call(page, 'mediaFolderEntries')).toEqual([])
})

test('collects an orphaned binding on reopen after closing the page during the first metadata write', async ({
  page,
  context,
}) => {
  const id = await project(page)
  await call(page, 'seedMedia', 'good.webm')
  await call(page, 'seedMedia', 'interrupted.webm')
  await linkFiles(page, ['good.webm'])
  await expect.poll(() => call(page, 'getMedia')).toHaveLength(1)
  const [good] = await call(page, 'getMedia')
  await call(page, 'holdMetadataWrite')
  await linkFiles(page, ['interrupted.webm'])
  await expect.poll(() => call(page, 'waitingForMetadataWrite')).toBe(true)
  expect(await call(page, 'getBindingIds')).toHaveLength(2)
  await page.close()
  const reopened = await context.newPage()
  await openProject(reopened, id)
  expect(await call(reopened, 'getMedia')).toMatchObject([{ id: good.id }])
  expect(await call(reopened, 'getBindingIds')).toHaveLength(1)
  expect(await call(reopened, 'readMedia', good.id)).toBe(
    await call(reopened, 'originalDigest', 'good.webm'),
  )
})

test('lets only the two admitted files finish on cancel and refuses writes after project removal', async ({
  page,
}, testInfo) => {
  const id = await project(page)
  const library = page.locator('.media-grid')
  await expect(library.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
  const paths = ['a.webm', 'b.webm', 'c.webm', 'd.webm']
  for (const path of paths) await call(page, 'seedMedia', path)
  await call(page, 'holdMetadataWrite')
  await linkFiles(page, paths)
  await expect.poll(() => call(page, 'waitingForMetadataWrite')).toBe(true)
  const progress = page.getByRole('dialog', { name: 'Linking Media', exact: true })
  await expect(progress.getByText('Processed 0 / 4', { exact: true })).toBeVisible()
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  await expect(library.getByRole('dialog', { name: 'Linking Media', exact: true })).toHaveCount(0)
  await progress.screenshot({ path: testInfo.outputPath('linked-media-progress.png') })
  const cancel = progress.getByRole('button', { name: 'Cancel', exact: true })
  await cancel.click()
  await expect(cancel).toBeDisabled()
  await expect(progress.getByText('Finishing files already started…')).toBeVisible()
  await call(page, 'releaseMetadataWrite')
  await expect(progress).toBeHidden()
  await expect.poll(() => call(page, 'getMedia')).toHaveLength(2)
  await expect(
    page.getByText('Linked 2 · Failed 0 · Not started 2', { exact: false }),
  ).toBeVisible()
  await call(page, 'holdMetadataWrite')
  await linkFiles(page, ['c.webm'])
  await expect.poll(() => call(page, 'waitingForMetadataWrite')).toBe(true)
  const deleted = call(page, 'deleteProjectAndTestLateWrite', id)
  await call(page, 'releaseMetadataWrite')
  expect(await deleted).toEqual({
    rejectedWhileDeleting: true,
    rejectedAfterDeleting: true,
    exists: false,
    ids: [],
  })
  expect(await call(page, 'originalDigest', 'c.webm')).toBe(
    await call(page, 'originalDigest', 'a.webm'),
  )
})

test('keeps timeline references for a damaged v2 link missing its SHA-256', async ({ page }) => {
  const projectId = await project(page)
  await call(page, 'seedMedia', 'take.webm')
  await linkFiles(page, ['take.webm'])
  await expect.poll(() => call(page, 'getMedia')).toHaveLength(1)
  const [media] = await call(page, 'getMedia')
  const clip = await call(page, 'attachTrimmedClip', media.id, 2, 15)
  await call(page, 'removeContentDigest', media.id)
  await openProject(page, projectId)
  expect(await call(page, 'getMedia')).toMatchObject([
    { id: media.id, status: 'missing', issue: 'damaged' },
  ])
  expect(await call(page, 'getClip')).toMatchObject({
    mediaId: media.id,
    timeRange: clip!.timeRange,
  })
  expect(await call(page, 'getBindingIds')).toHaveLength(1)
})

test('discards an import whose originating session expired before processing', async ({ page }) => {
  await project(page)
  await call(page, 'seedMedia', 'session/take.webm')
  await call(page, 'importWithExpiredSession', 'session')
  expect(await call(page, 'getMedia')).toEqual([])
  expect(await call(page, 'getBindingIds')).toEqual([])
  expect(await call(page, 'mediaFolderEntries')).toEqual([])
})

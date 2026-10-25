import { isAgentToolImage } from '../services/agentImageValidation'
import { indexedDBService } from '@/core/storage/IndexedDBService'
import {
  MessagePartType,
  type AgentAttachment,
  type AgentAttachmentRecord,
  type ProviderUpload,
  type AgentSession,
  type AgentToolImage,
  type AgentUserAttachmentRecord,
} from '../types'
import { toolContractVersion } from './ToolRuntime'
import { PathResolver } from '@/core/filesystem/core/PathResolver'
import {
  AGENT_MAX_IMAGE_EDGE,
  AGENT_MAX_IMAGE_ORIGINAL_BYTES,
  AGENT_MAX_IMAGE_PIXELS,
} from '../constants/visual'

/** 固定快照：剥离 Vue 代理，排队后不再读取正在变化的响应式对象。 */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isAttachment(value: unknown): value is AgentAttachment {
  const image = value as Partial<AgentAttachment> | undefined
  const original = image?.original
  const params = image?.conversionParams
  if (
    typeof image?.id !== 'string' ||
    !image.id ||
    typeof image.userId !== 'string' ||
    !image.userId ||
    typeof image.projectId !== 'string' ||
    !image.projectId ||
    !original ||
    !params ||
    typeof original.fileName !== 'string' ||
    !Number.isInteger(original.byteSize) ||
    original.byteSize <= 0 ||
    original.byteSize > AGENT_MAX_IMAGE_ORIGINAL_BYTES ||
    !Number.isInteger(original.width) ||
    !Number.isInteger(original.height) ||
    original.width <= 0 ||
    original.height <= 0 ||
    original.width * original.height > AGENT_MAX_IMAGE_PIXELS ||
    !Number.isInteger(params.width) ||
    !Number.isInteger(params.height) ||
    params.width <= 0 ||
    params.height <= 0 ||
    Math.max(params.width, params.height) > AGENT_MAX_IMAGE_EDGE ||
    params.mimeType !== 'image/webp' ||
    !Number.isFinite(params.quality) ||
    params.quality <= 0 ||
    params.quality > 1
  )
    return false
  try {
    return (
      original.relativePath ===
      new PathResolver().getAgentAttachmentPath(image.projectId, image.id, original.mimeType)
    )
  } catch {
    return false
  }
}

/** 按记录类型选择校验方式，避免将工具观察图当成用户原图处理。 */
function isRecord(value: unknown): value is AgentAttachmentRecord {
  const record = value as Partial<AgentAttachmentRecord> | undefined
  return record?.recordKind === 'user_attachment' ? isAttachment(record) : isAgentToolImage(record)
}

/** 从消息角色推导图片类型；消息 ID 同时用于阻止历史图片被新结果复用。 */
function imageReferences(session: AgentSession) {
  return session.messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === MessagePartType.IMAGE
        ? [
            {
              messageId: message.id,
              id: part.attachmentId,
              kind:
                message.role === 'user'
                  ? 'user_attachment'
                  : message.role === 'tool'
                    ? 'tool_image'
                    : 'invalid',
            },
          ]
        : [],
    ),
  )
}

function imageReferenceKey(ref: ReturnType<typeof imageReferences>[number]): string {
  return JSON.stringify([ref.messageId, ref.id, ref.kind])
}

/** 会话快照与图片原子提交；诊断日志由 AgentTelemetry 独立管理。 */
export class AgentSessionStore {
  private queue: Promise<void> = Promise.resolve()

  /** 账户、工程及工具契约共同组成分区，旧工具契约的历史不会被当前实现读取。 */
  owner(userId: string, projectId: string) {
    return JSON.stringify([userId, projectId, toolContractVersion])
  }

  /** 固定消息、用量及调用摘要，只保留恢复待回答问题所需的工具记录。 */
  save(
    session: AgentSession,
    images: readonly (AgentAttachment | AgentToolImage)[] = [],
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal,
  ): Promise<void> {
    const data = snapshot({
      ...session,
      toolExecutions: Object.fromEntries(
        Object.entries(session.toolExecutions).filter(
          ([assistantId, execution]) =>
            execution.status === 'pending' &&
            execution.call.name === 'ask_user' &&
            session.messages.some(
              (message) =>
                message.id === assistantId &&
                message.interaction?.interrupt.interaction_id === execution.call.id &&
                !message.interaction.result,
            ),
        ),
      ),
    })
    // Blob 不经过 JSON 序列化；分别固定元数据快照和观察时的图片字节。
    const pending = images.map((image) => {
      if ('recordKind' in image && image.recordKind === 'tool_image')
        return { ...snapshot({ ...image, blob: undefined }), blob: image.blob }
      const { id, userId, projectId, original, conversionParams } = image as AgentAttachment
      return {
        ...snapshot({ id, userId, projectId, original, conversionParams }),
        recordKind: 'user_attachment' as const,
      }
    })
    const refs = imageReferences(data)
    const ids = new Set<string>()
    for (const image of pending) {
      if (!isRecord(image) || ids.has(image.id))
        return Promise.reject(new Error('INVALID_AGENT_ATTACHMENT'))
      ids.add(image.id)
      if (image.userId !== data.userId || image.projectId !== data.projectId)
        return Promise.reject(new Error('INVALID_AGENT_ATTACHMENT_OWNER'))
      if (!refs.some((ref) => ref.id === image.id && ref.kind === image.recordKind))
        return Promise.reject(new Error('UNREFERENCED_AGENT_ATTACHMENT'))
    }
    return this.enqueue(async () => {
      if (!isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
      const db = await indexedDBService.openDB()
      if (!isCurrent()) throw new Error('TOOL_CONTEXT_EXPIRED')
      const owner = this.owner(data.userId, data.projectId)
      const key = JSON.stringify([owner, data.id])
      await new Promise<void>((resolve, reject) => {
        // 消息与所有新增图片共用事务；任一写入失败或调用取消都整体回滚。
        const transaction = db.transaction(['agentSessions', 'agentAttachments'], 'readwrite')
        const cancel = () => transaction.abort()
        const cleanup = () => signal?.removeEventListener('abort', cancel)
        if (signal?.aborted) {
          transaction.abort()
          reject(signal.reason)
          return
        }
        signal?.addEventListener('abort', cancel, { once: true })
        transaction.oncomplete = () => {
          cleanup()
          resolve()
        }
        transaction.onerror = transaction.onabort = () => {
          cleanup()
          reject(transaction.error ?? new Error('对话图片存储事务失败'))
        }
        const sessionStore = transaction.objectStore('agentSessions')
        const imageStore = transaction.objectStore('agentAttachments')
        const previous = sessionStore.get(key)
        previous.onsuccess = () => {
          if (!isCurrent()) {
            transaction.abort()
            return
          }
          const saved = previous.result?.data as AgentSession | undefined
          const savedRefs = saved ? imageReferences(saved) : []
          const oldRefs = new Set(savedRefs.map(imageReferenceKey))
          const oldIds = new Set(savedRefs.map((ref) => ref.id))
          sessionStore.put({ key, owner, sessionKey: key, data })
          for (const image of pending) {
            const imageKey = JSON.stringify([key, image.id])
            const request = imageStore.get(imageKey)
            request.onsuccess = () => {
              if (!isCurrent()) {
                transaction.abort()
                return
              }
              if (request.result) {
                // 重试可以保留既有引用，但不能替换历史图片字节、记录类型或消息归属。
                if (
                  !oldIds.has(image.id) ||
                  !isRecord(request.result) ||
                  request.result.recordKind !== image.recordKind ||
                  request.result.key !== imageKey ||
                  request.result.owner !== owner ||
                  request.result.sessionKey !== key ||
                  request.result.userId !== data.userId ||
                  request.result.projectId !== data.projectId ||
                  refs.some((ref) => ref.id === image.id && !oldRefs.has(imageReferenceKey(ref)))
                )
                  transaction.abort()
              } else {
                try {
                  imageStore.add({ ...image, key: imageKey, owner, sessionKey: key })
                } catch (error) {
                  transaction.abort()
                  reject(error)
                }
              }
            }
          }
          for (const ref of refs) {
            if (ref.kind === 'invalid') {
              transaction.abort()
              return
            }
            // 旧引用缺少图片时由界面显示不可用，不阻塞后续保存；新增引用仍须完整校验。
            if (
              oldRefs.has(imageReferenceKey(ref)) ||
              pending.some((image) => image.id === ref.id && image.recordKind === ref.kind)
            )
              continue
            const imageKey = JSON.stringify([key, ref.id])
            const request = imageStore.get(imageKey)
            request.onsuccess = () => {
              const record = request.result
              if (
                !isCurrent() ||
                !isRecord(record) ||
                record.recordKind !== ref.kind ||
                record.key !== imageKey ||
                record.owner !== owner ||
                record.sessionKey !== key ||
                record.id !== ref.id ||
                record.userId !== data.userId ||
                record.projectId !== data.projectId
              )
                transaction.abort()
            }
          }
        }
      })
    })
  }

  /** 读取当前分区的会话；只恢复数据，运行控制器和 Promise 不属于存储内容。 */
  async load(userId: string, projectId: string): Promise<AgentSession[]> {
    await this.queue
    const db = await indexedDBService.openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('agentSessions', 'readonly')
      let sessions: AgentSession[] = []
      transaction.oncomplete = () => resolve(sessions)
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
      const request = transaction
        .objectStore('agentSessions')
        .index('owner')
        .getAll(this.owner(userId, projectId))
      request.onsuccess = () => {
        sessions = request.result.map((record) => record.data as AgentSession)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /** 删除会话快照；排在此前保存之后，避免被旧写入重新创建。 */
  delete(session: AgentSession): Promise<AgentAttachmentRecord[]> {
    const owner = this.owner(session.userId, session.projectId)
    const key = JSON.stringify([owner, session.id])
    return this.enqueue(async () => {
      const db = await indexedDBService.openDB()
      return new Promise<AgentAttachmentRecord[]>((resolve, reject) => {
        const removed: AgentAttachmentRecord[] = []
        const transaction = db.transaction(['agentSessions', 'agentAttachments'], 'readwrite')
        transaction.oncomplete = () => resolve(removed)
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error ?? new Error('对话图片存储事务失败'))
        transaction.objectStore('agentSessions').delete(key)
        const request = transaction.objectStore('agentAttachments').index('session').openCursor(key)
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            const record = cursor.value as AgentAttachmentRecord
            if (
              record.owner === owner &&
              record.sessionKey === key &&
              record.userId === session.userId &&
              record.projectId === session.projectId &&
              record.key === cursor.primaryKey &&
              record.key === JSON.stringify([key, record.id])
            ) {
              if (isRecord(record)) removed.push(record)
              cursor.delete()
            }
            cursor.continue()
          }
        }
      })
    })
  }

  /** 读取当前会话的图片；素材导入等入口可额外要求用户消息明确引用该原图。 */
  async readImage(
    session: Pick<AgentSession, 'id' | 'userId' | 'projectId'>,
    id: string,
    options: { requireUserReference?: boolean } = {},
  ): Promise<AgentAttachmentRecord | undefined> {
    await this.queue
    const db = await indexedDBService.openDB()
    const owner = this.owner(session.userId, session.projectId)
    const sessionKey = JSON.stringify([owner, session.id])
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['agentAttachments', 'agentSessions'], 'readonly')
      const request = transaction
        .objectStore('agentAttachments')
        .get(JSON.stringify([sessionKey, id]))
      const sessionRequest = options.requireUserReference
        ? transaction.objectStore('agentSessions').get(sessionKey)
        : undefined
      transaction.oncomplete = () => {
        const image = request.result as AgentAttachmentRecord | undefined
        const saved = sessionRequest?.result?.data as AgentSession | undefined
        if (
          !isRecord(image) ||
          image.key !== JSON.stringify([sessionKey, id]) ||
          image.owner !== owner ||
          image.sessionKey !== sessionKey ||
          image.userId !== session.userId ||
          image.projectId !== session.projectId ||
          image.id !== id ||
          (options.requireUserReference &&
            (image.recordKind !== 'user_attachment' ||
              !saved ||
              saved.id !== session.id ||
              saved.userId !== session.userId ||
              saved.projectId !== session.projectId ||
              !saved.messages.some(
                (message) =>
                  message.role === 'user' &&
                  message.parts.some(
                    (part) => part.type === MessagePartType.IMAGE && part.attachmentId === id,
                  ),
              )))
        )
          resolve(undefined)
        else resolve(image)
      }
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  }

  /** 只更新仍属于当前调用的上传缓存，不改变已经保存的图片内容。 */
  updateImageUpload(
    image: AgentAttachmentRecord,
    providerId: string,
    upload: ProviderUpload | undefined,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    return this.enqueue(async () => {
      if (!isCurrent()) return false
      const db = await indexedDBService.openDB()
      if (!isCurrent()) return false
      return new Promise<boolean>((resolve, reject) => {
        let updated = false
        const transaction = db.transaction('agentAttachments', 'readwrite')
        const store = transaction.objectStore('agentAttachments')
        const request = store.get(image.key)
        request.onsuccess = () => {
          const existing = request.result as AgentAttachmentRecord | undefined
          if (
            isCurrent() &&
            isRecord(existing) &&
            existing.recordKind === image.recordKind &&
            existing.owner === image.owner &&
            existing.sessionKey === image.sessionKey &&
            existing.id === image.id &&
            existing.userId === image.userId &&
            existing.projectId === image.projectId
          ) {
            const providerUploads = {
              ...existing.providerUploads,
              ...(upload ? { [providerId]: upload } : {}),
            }
            if (!upload) delete providerUploads[providerId]
            store.put({ ...existing, providerUploads })
            updated = true
          }
        }
        transaction.oncomplete = () => resolve(updated)
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
      })
    })
  }

  /** 仅列出需要文件系统清理的用户原图；工具观察图随会话在数据库中删除。 */
  async listProjectAttachments(projectId: string): Promise<AgentUserAttachmentRecord[]> {
    await this.queue
    const db = await indexedDBService.openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('agentAttachments', 'readonly')
      const request = transaction.objectStore('agentAttachments').getAll()
      transaction.oncomplete = () =>
        resolve(
          (request.result as AgentAttachmentRecord[]).filter(
            (item): item is AgentUserAttachmentRecord =>
              item.recordKind === 'user_attachment' &&
              isAttachment(item) &&
              item.projectId === projectId,
          ),
        )
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  }

  /** 串行执行存储操作；单次失败仍向调用者报告，后续已授权保存可以继续排队。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }
}

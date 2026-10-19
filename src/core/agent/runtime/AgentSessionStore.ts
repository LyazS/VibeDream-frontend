import { indexedDBService } from '@/core/storage/IndexedDBService'
import {
  MessagePartType,
  type AgentAttachment,
  type AgentAttachmentRecord,
  type AgentSession,
} from '../types'
import { toolContractVersion } from './ToolRuntime'
import { PathResolver } from '@/core/filesystem/core/PathResolver'

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
    original.byteSize > 10 * 1024 * 1024 ||
    !Number.isInteger(original.width) ||
    !Number.isInteger(original.height) ||
    original.width <= 0 ||
    original.height <= 0 ||
    original.width * original.height > 40_000_000 ||
    !Number.isInteger(params.width) ||
    !Number.isInteger(params.height) ||
    params.width <= 0 ||
    params.height <= 0 ||
    Math.max(params.width, params.height) > 2048 ||
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

/** 会话快照与图片原子提交；诊断日志由 AgentTelemetry 独立管理。 */
export class AgentSessionStore {
  private queue: Promise<void> = Promise.resolve()

  /** 账户、工程及工具契约共同组成分区，旧工具契约的历史不会被当前实现读取。 */
  owner(userId: string, projectId: string) {
    return JSON.stringify([userId, projectId, toolContractVersion])
  }

  /** 固定消息、用量及调用摘要，只保留恢复待回答问题所需的工具记录。 */
  save(session: AgentSession, images: readonly AgentAttachment[] = []): Promise<void> {
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
    const pending = images.map(({ id, userId, projectId, original, conversionParams }) =>
      snapshot({ id, userId, projectId, original, conversionParams }),
    )
    for (const image of pending) {
      if (!isAttachment(image)) return Promise.reject(new Error('INVALID_AGENT_ATTACHMENT'))
      if (image.userId !== data.userId || image.projectId !== data.projectId)
        return Promise.reject(new Error('INVALID_AGENT_ATTACHMENT_OWNER'))
    }
    return this.enqueue(async () => {
      const db = await indexedDBService.openDB()
      const owner = this.owner(data.userId, data.projectId)
      const key = JSON.stringify([owner, data.id])
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['agentSessions', 'agentAttachments'], 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error ?? new Error('对话图片存储事务失败'))
        const sessionStore = transaction.objectStore('agentSessions')
        const previous = sessionStore.get(key)
        sessionStore.put({ key, owner, sessionKey: key, data })
        const imageStore = transaction.objectStore('agentAttachments')
        const imageIds = new Set(
          data.messages
            .filter((message) => message.role === 'user')
            .flatMap((message) =>
              message.parts.flatMap((part) =>
                part.type === MessagePartType.IMAGE ? [part.attachmentId] : [],
              ),
            ),
        )
        for (const image of pending) {
          if (!imageIds.has(image.id)) continue
          const imageKey = JSON.stringify([key, image.id])
          const request = imageStore.getKey(imageKey)
          request.onsuccess = () => {
            if (!request.result)
              imageStore.add({
                ...image,
                key: imageKey,
                owner,
                sessionKey: key,
              } satisfies AgentAttachmentRecord)
          }
        }
        // Only new references must exist: damaged history cannot block subsequent saves.
        previous.onsuccess = () => {
          const saved = previous.result?.data as AgentSession | undefined
          const existing = new Set(
            saved?.messages.flatMap((message) =>
              message.parts.flatMap((part) =>
                part.type === MessagePartType.IMAGE
                  ? [JSON.stringify([message.id, part.attachmentId])]
                  : [],
              ),
            ),
          )
          for (const message of data.messages.filter((message) => message.role === 'user')) {
            for (const part of message.parts) {
              if (
                part.type !== MessagePartType.IMAGE ||
                existing.has(JSON.stringify([message.id, part.attachmentId])) ||
                pending.some((image) => image.id === part.attachmentId)
              )
                continue
              const request = imageStore.getKey(JSON.stringify([key, part.attachmentId]))
              request.onsuccess = () => {
                if (!request.result) transaction.abort()
              }
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
              record.key === cursor.primaryKey
            ) {
              if (isAttachment(record)) removed.push(record)
              cursor.delete()
            }
            cursor.continue()
          }
        }
      })
    })
  }

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
          !isAttachment(image) ||
          image.key !== JSON.stringify([sessionKey, id]) ||
          image.owner !== owner ||
          image.sessionKey !== sessionKey ||
          image.userId !== session.userId ||
          image.projectId !== session.projectId ||
          image.id !== id ||
          (options.requireUserReference &&
            (!saved ||
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

  updateImageUpload(
    image: AgentAttachmentRecord,
    upload: AgentAttachmentRecord['upload'],
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
            existing?.owner === image.owner &&
            existing.sessionKey === image.sessionKey &&
            existing.id === image.id &&
            existing.userId === image.userId &&
            existing.projectId === image.projectId
          ) {
            store.put({ ...existing, upload })
            updated = true
          }
        }
        transaction.oncomplete = () => resolve(updated)
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
      })
    })
  }

  async listProjectAttachments(projectId: string): Promise<AgentAttachmentRecord[]> {
    await this.queue
    const db = await indexedDBService.openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('agentAttachments', 'readonly')
      const request = transaction.objectStore('agentAttachments').getAll()
      transaction.oncomplete = () =>
        resolve(
          (request.result as AgentAttachmentRecord[]).filter(
            (item) => isAttachment(item) && item.projectId === projectId,
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

import { indexedDBService } from '@/core/storage/IndexedDBService'
import {
  MessagePartType,
  type AgentImage,
  type AgentImageRecord,
  type AgentSession,
} from '../types'
import { toolContractVersion } from './ToolRuntime'

/** 固定快照：剥离 Vue 代理，排队后不再读取正在变化的响应式对象。 */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 会话快照与图片原子提交；诊断日志由 AgentTelemetry 独立管理。 */
export class AgentSessionStore {
  private queue: Promise<void> = Promise.resolve()

  /** 账户、工程及工具契约共同组成分区，旧工具契约的历史不会被当前实现读取。 */
  owner(userId: string, projectId: string) {
    return JSON.stringify([userId, projectId, toolContractVersion])
  }

  /** 固定消息、用量及调用摘要，只保留恢复待回答问题所需的工具记录。 */
  save(session: AgentSession, images: readonly AgentImage[] = []): Promise<void> {
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
    const pending = images.map((image) => ({ ...image }))
    return this.enqueue(async () => {
      const db = await indexedDBService.openDB()
      const owner = this.owner(data.userId, data.projectId)
      const key = JSON.stringify([owner, data.id])
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['agentSessions', 'agentImages'], 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error ?? new Error('对话图片存储事务失败'))
        transaction.objectStore('agentSessions').put({ key, owner, sessionKey: key, data })
        const imageStore = transaction.objectStore('agentImages')
        const imageIds = new Set(
          data.messages
            .filter((message) => message.role === 'user')
            .flatMap((message) =>
              message.parts.flatMap((part) =>
                part.type === MessagePartType.IMAGE ? [part.imageId] : [],
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
              } satisfies AgentImageRecord)
          }
        }
        // A dangling reference must abort the entire message/image commit.
        for (const id of imageIds) {
          if (pending.some((image) => image.id === id)) continue
          const request = imageStore.getKey(JSON.stringify([key, id]))
          request.onsuccess = () => {
            if (!request.result) transaction.abort()
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
  delete(session: AgentSession): Promise<void> {
    const owner = this.owner(session.userId, session.projectId)
    const key = JSON.stringify([owner, session.id])
    return this.enqueue(async () => {
      const db = await indexedDBService.openDB()
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['agentSessions', 'agentImages'], 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error ?? new Error('对话图片存储事务失败'))
        transaction.objectStore('agentSessions').delete(key)
        const request = transaction.objectStore('agentImages').index('session').openCursor(key)
        request.onsuccess = () => {
          const cursor = request.result
          if (cursor) {
            cursor.delete()
            cursor.continue()
          }
        }
      })
    })
  }

  async readImage(
    session: Pick<AgentSession, 'id' | 'userId' | 'projectId'>,
    id: string,
  ): Promise<AgentImageRecord> {
    await this.queue
    const db = await indexedDBService.openDB()
    const owner = this.owner(session.userId, session.projectId)
    const sessionKey = JSON.stringify([owner, session.id])
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('agentImages', 'readonly')
      const request = transaction.objectStore('agentImages').get(JSON.stringify([sessionKey, id]))
      transaction.oncomplete = () => {
        const image = request.result as AgentImageRecord | undefined
        if (!image || image.owner !== owner || image.sessionKey !== sessionKey)
          reject(new Error('无法读取对话图片'))
        else resolve(image)
      }
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  }

  updateImageUpload(
    image: AgentImageRecord,
    upload: AgentImageRecord['upload'],
    isCurrent: () => boolean,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (!isCurrent()) return
      const db = await indexedDBService.openDB()
      if (!isCurrent()) return
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('agentImages', 'readwrite')
        const store = transaction.objectStore('agentImages')
        const request = store.get(image.key)
        request.onsuccess = () => {
          const existing = request.result as AgentImageRecord | undefined
          if (
            isCurrent() &&
            existing?.owner === image.owner &&
            existing.sessionKey === image.sessionKey
          )
            store.put({ ...existing, upload })
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
      })
    })
  }

  /** 串行执行存储操作；单次失败仍向调用者报告，后续已授权保存可以继续排队。 */
  private enqueue(operation: () => Promise<void>) {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => {})
    return pending
  }
}

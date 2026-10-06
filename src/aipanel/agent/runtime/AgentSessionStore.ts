import { indexedDBService } from '@/core/storage/IndexedDBService'
import type { AgentSession, ToolExecution } from '@/core/modules/UnifiedAgentModule'
import { toolContractVersion } from './ToolRuntime'

const stores = ['agentSessions', 'agentTurns', 'agentTools']

/** 固定快照：剥离 Vue 代理，排队后不再读取正在变化的响应式对象。 */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 工具日志只承担落盘，不保留完成执行的内存字典，不恢复或重放副作用。 */
export class ToolJournal {
  /** 在同一会话事务内记录本轮工具的参数、归属及原结果。 */
  write(transaction: IDBTransaction, sessionKey: string, owner: string, execution: ToolExecution) {
    transaction.objectStore('agentTools').put({
      key: JSON.stringify([sessionKey, execution.call.id]),
      owner,
      sessionKey,
      execution,
    })
  }
}

/** 新 Agent 的独立存储；顺序提交固定快照，事务完成后才视为保存成功。 */
export class AgentSessionStore {
  private queue: Promise<void> = Promise.resolve()
  private journal = new ToolJournal()

  /** 账户、工程及工具契约共同组成分区，旧工具契约的历史不会被当前实现读取。 */
  owner(userId: string, projectId: string) {
    return JSON.stringify([userId, projectId, toolContractVersion])
  }

  /** 将会话和最新 turn、待执行/已完成工具日志一起原子保存。 */
  save(session: AgentSession, completedTool?: ToolExecution): Promise<void> {
    const data = snapshot(session)
    const completed = completedTool ? snapshot(completedTool) : undefined
    return this.enqueue(async () => {
      const db = await indexedDBService.openDB()
      const owner = this.owner(data.userId, data.projectId)
      const key = JSON.stringify([owner, data.id])
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(stores, 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
        transaction.objectStore('agentSessions').put({ key, owner, sessionKey: key, data })
        if (data.latestTurn) {
          transaction.objectStore('agentTurns').put({
            key: JSON.stringify([key, data.latestTurn.id]),
            owner,
            sessionKey: key,
            turn: data.latestTurn,
          })
        }
        for (const execution of Object.values(data.toolExecutions)) {
          this.journal.write(transaction, key, owner, execution)
        }
        if (completed) this.journal.write(transaction, key, owner, completed)
      })
    })
  }

  /** 读取当前分区的会话；只恢复数据，运行控制器和 Promise 不属于存储内容。 */
  async load(userId: string, projectId: string): Promise<AgentSession[]> {
    await this.queue
    const db = await indexedDBService.openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('agentSessions', 'readonly')
      const request = transaction
        .objectStore('agentSessions')
        .index('owner')
        .getAll(this.owner(userId, projectId))
      request.onsuccess = () => resolve(request.result.map((record) => record.data))
      request.onerror = () => reject(request.error)
    })
  }

  /** 删除同一会话的消息、请求快照和工具日志；排在此前保存之后，避免被旧写入重新创建。 */
  delete(session: AgentSession): Promise<void> {
    const owner = this.owner(session.userId, session.projectId)
    const key = JSON.stringify([owner, session.id])
    return this.enqueue(async () => {
      const db = await indexedDBService.openDB()
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(stores, 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
        for (const name of stores) {
          const request = transaction.objectStore(name).index('session').openCursor(key)
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) return
            cursor.delete()
            cursor.continue()
          }
        }
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

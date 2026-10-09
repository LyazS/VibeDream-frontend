/**
 * IndexedDB 统一管理服务
 * 所有模块共享同一个数据库连接和版本管理
 */
export class IndexedDBService {
  private static instance: IndexedDBService | null = null
  private db: IDBDatabase | null = null

  private readonly DB_NAME = 'VideoEditorDB'
  private readonly DB_VERSION = 5

  // 私有构造函数，确保单例
  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): IndexedDBService {
    if (!IndexedDBService.instance) {
      IndexedDBService.instance = new IndexedDBService()
    }
    return IndexedDBService.instance
  }

  /**
   * 初始化/打开数据库
   */
  async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('INDEXED_DB_UPGRADE_BLOCKED'))
      request.onsuccess = () => {
        this.db = request.result
        const opened = request.result
        opened.onversionchange = () => {
          opened.close()
          if (this.db === opened) this.db = null
        }
        resolve(request.result)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const transaction = request.transaction!

        // handles store（FileSystemAccessAdapter 使用）
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles')
        }

        if (db.objectStoreNames.contains('agentTurns')) {
          transaction.objectStore('agentTurns').name = 'agentModelCalls'
        }

        // 会话、模型请求快照和工具日志按账户、工程及工具契约分区。
        for (const name of ['agentSessions', 'agentModelCalls', 'agentTools', 'agentLogs']) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'key' })
            store.createIndex('owner', 'owner')
            store.createIndex('session', 'sessionKey')
          }
        }

        if (event.oldVersion === 3) {
          const rename = (record: Record<string, unknown>, from: string, to: string) => {
            if (from in record) {
              record[to] = record[from]
              delete record[from]
            }
          }
          const migrateCall = (value: unknown) => {
            if (!value || typeof value !== 'object') return
            const call = value as Record<string, unknown>
            for (const field of ['request', 'completion']) {
              const snapshot = call[field]
              if (snapshot && typeof snapshot === 'object') {
                rename(snapshot as Record<string, unknown>, 'turnId', 'modelCallId')
              }
            }
          }
          // Only migrate known persistence fields; tool arguments and output stay opaque.
          for (const name of ['agentSessions', 'agentModelCalls', 'agentTools']) {
            const cursorRequest = transaction.objectStore(name).openCursor()
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result
              if (!cursor) return
              const record = cursor.value
              if (name === 'agentSessions') {
                rename(record.data, 'latestTurn', 'latestModelCall')
                migrateCall(record.data.latestModelCall)
                for (const execution of Object.values(record.data.toolExecutions)) {
                  rename(execution as Record<string, unknown>, 'turnId', 'modelCallId')
                }
              } else if (name === 'agentModelCalls') {
                rename(record, 'turn', 'modelCall')
                migrateCall(record.modelCall)
              } else {
                rename(record.execution, 'turnId', 'modelCallId')
              }
              cursor.update(record)
              cursor.continue()
            }
          }
        }
      }
    })
  }

  /**
   * 通用事务操作方法
   */
  async transaction<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDB()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode)
      const store = transaction.objectStore(storeName)
      const request = operation(store)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// 导出单例
export const indexedDBService = IndexedDBService.getInstance()

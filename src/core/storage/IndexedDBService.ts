/**
 * IndexedDB 统一管理服务
 * 所有模块共享同一个数据库连接和版本管理
 */
export class IndexedDBService {
  private static instance: IndexedDBService | null = null
  private db: IDBDatabase | null = null

  private readonly DB_NAME = 'VideoEditorDB'
  private readonly DB_VERSION = 6

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
        const db = request.result

        // handles store（FileSystemAccessAdapter 使用）
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles')
        }

        // 重建聊天存储，清除旧会话及本地调用/工具诊断记录；保留日志补传队列。
        if (event.oldVersion < 6) {
          for (const name of ['agentSessions', 'agentTurns', 'agentModelCalls', 'agentTools']) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
          }
        }

        for (const name of ['agentSessions', 'agentLogs']) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'key' })
            store.createIndex('owner', 'owner')
            store.createIndex('session', 'sessionKey')
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

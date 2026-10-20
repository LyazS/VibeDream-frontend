/** 只用于错误注入和队列契约测试；真实存储验收在浏览器中执行。 */
export class MemoryFile {
  readonly kind = 'file'
  content = new Blob()

  constructor(readonly name: string) {}

  async getFile() {
    return new File([this.content], this.name)
  }

  async createWritable() {
    let pending = new Blob()
    return {
      write: async (value: string | Blob) => {
        pending = typeof value === 'string' ? new Blob([value]) : value
      },
      close: async () => {
        this.content = pending
      },
      abort: async () => {},
    }
  }
}

export class MemoryDirectory {
  readonly kind = 'directory'
  readonly children = new Map<string, MemoryDirectory | MemoryFile>()
  removed = false

  constructor(readonly name = '') {}

  private assertExists() {
    if (this.removed) throw new DOMException('Directory removed', 'NotFoundError')
  }

  async getDirectoryHandle(name: string, { create = false } = {}): Promise<MemoryDirectory> {
    this.assertExists()
    let entry = this.children.get(name)
    if (!entry && create) {
      entry = new MemoryDirectory(name)
      this.children.set(name, entry)
    }
    if (!entry) throw new DOMException('Directory missing', 'NotFoundError')
    if (entry.kind !== 'directory')
      throw new DOMException('Expected directory', 'TypeMismatchError')
    return entry
  }

  async getFileHandle(name: string, { create = false } = {}): Promise<MemoryFile> {
    this.assertExists()
    let entry = this.children.get(name)
    if (!entry && create) {
      entry = new MemoryFile(name)
      this.children.set(name, entry)
    }
    if (!entry) throw new DOMException('File missing', 'NotFoundError')
    if (entry.kind !== 'file') throw new DOMException('Expected file', 'TypeMismatchError')
    return entry
  }

  async removeEntry(name: string, { recursive = false } = {}) {
    this.assertExists()
    const entry = this.children.get(name)
    if (!entry) throw new DOMException('Entry missing', 'NotFoundError')
    if (entry.kind === 'directory') {
      if (entry.children.size && !recursive)
        throw new DOMException('Directory not empty', 'InvalidModificationError')
      entry.removed = true
    }
    this.children.delete(name)
  }

  async *entries() {
    this.assertExists()
    yield* this.children.entries()
  }
}

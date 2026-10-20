/** 取消时立即结束等待；原生异步操作仍会被接收，其迟到结果可交给回调释放。 */
export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  releaseLate?: (value: T) => void,
): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    let cancelled = false
    const abort = () => {
      // 取消只能中断等待，不能保证底层解码或编码操作停止。
      cancelled = true
      reject(signal.reason ?? new DOMException('操作已取消', 'AbortError'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (cancelled) {
          try {
            releaseLate?.(value)
          } catch {
            /* 迟到结果的清理失败不能再次影响已经取消的调用。 */
          }
        } else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        if (!cancelled) reject(error)
      },
    )
  })
}

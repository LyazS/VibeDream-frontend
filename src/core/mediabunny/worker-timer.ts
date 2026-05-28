import { RENDERER_FPS } from './constant'

function truncateToOneDecimal(num: number): number {
  return Math.floor(num * 10) / 10
}
// 计算基础时间间隔（ms）翻倍以更精准控制
const FRAME_INTERVAL = truncateToOneDecimal(1000 / (RENDERER_FPS * 2))

/**
 * WebWorker 内部的定时器设置函数
 *
 * 该函数会在 Worker 线程中执行，负责创建一个基础的定时器
 * Worker 中的定时器不受浏览器后台页面限制的影响
 *
 * @param frameInterval - 基础时间间隔（ms）
 */
const setup = (frameInterval: number): void => {
  let timerId: number

  // 使用传入的基础时间间隔
  const interval: number = frameInterval

  // 监听来自主线程的消息
  self.onmessage = (e) => {
    // 启动定时器
    if (e.data.event === 'start') {
      self.clearInterval(timerId)
      // 每隔 interval 毫秒向主线程发送一次消息
      timerId = self.setInterval(() => {
        self.postMessage({})
      }, interval)
    }

    // 停止定时器
    if (e.data.event === 'stop') {
      self.clearInterval(timerId)
    }
  }
}

/**
 * 创建 WebWorker 实例
 *
 * 通过 Blob 和 URL.createObjectURL 的方式内联创建 Worker
 * 这样可以避免需要单独的 Worker 文件
 *
 * @returns Worker 实例
 */
const createWorker = (): Worker => {
  // 将 setup 函数转换为字符串，并传入 FRAME_INTERVAL 参数
  const blob = new Blob([`(${setup.toString()})(${FRAME_INTERVAL})`])
  const url = URL.createObjectURL(blob)
  return new Worker(url)
}

/**
 * 任务管理映射表
 *
 * key: groupId - 时间分组ID，表示每隔多少个基础间隔（16.6ms）执行一次
 * value: Set<Function> - 该分组下的所有回调函数集合
 *
 * 例如：groupId = 60 表示每 60 * 16.6ms ≈ 1000ms 执行一次
 */
const handlerMap = new Map<number, Set<() => void>>()

/**
 * 运行计数器
 *
 * 每次 Worker 发送消息时递增
 * 通过 runCount % groupId === 0 来判断是否该执行某个分组的回调
 */
let runCount = 1

// 创建全局 Worker 实例（如果浏览器支持）
let worker: Worker | null = null
if (globalThis.Worker != null) {
  worker = createWorker()

  // 监听 Worker 发送的消息
  worker.onmessage = () => {
    runCount += 1

    // 遍历所有任务分组
    for (const [k, v] of handlerMap) {
      // 当计数器是分组ID的倍数时，执行该组的所有回调
      // 例如：groupId = 60，则在 runCount = 60, 120, 180... 时执行
      if (runCount % k === 0) for (const fn of v) fn()
    }
  }
}

/**
 * 基于 WebWorker 的后台定时器
 *
 * 专门解决页面长时间处于后台时，定时器不（或延迟）执行的问题
 *
 * ## 工作原理
 * 1. 利用 WebWorker 中的定时器不受后台限制的特性
 * 2. Worker 每 16.6ms 向主线程发送一次消息
 * 3. 主线程收到消息后，根据计数器判断是否执行对应的回调
 *
 * ## 使用场景
 * - 视频/音频播放器需要在后台持续更新进度
 * - 实时数据监控需要在后台定期轮询
 * - 其他需要在后台持续运行的定时任务
 *
 * ## 注意事项
 * - 时间精度基于 16.6ms 的倍数，会有一定偏差
 * - 如非必要，请优先使用原生 `setInterval`
 * - 最小间隔不能小于 4ms（浏览器限制）
 *
 * @param handler - 要执行的回调函数
 * @param time - 时间倍数，实际执行间隔 = time * FRAME_INTERVAL (16.6ms)
 *               例如：time = 1 表示每 16.6ms 执行一次
 *                    time = 60 表示每 1000ms 执行一次
 * @returns 清理函数，调用后会停止该定时任务
 *
 * @example
 * ```typescript
 * // 每帧执行一次（约 60FPS）
 * const stop1 = workerTimer(() => {
 *   console.log('每帧执行');
 * }, 1);
 *
 * // 每秒执行一次
 * const stop2 = workerTimer(() => {
 *   console.log('每秒执行');
 * }, 60);
 *
 * // 停止定时器
 * stop1();
 * stop2();
 * ```
 *
 * @see [JS 定时器时长控制细节](https://hughfenghen.github.io/posts/2023/06/15/timer-delay/)
 */
export const workerTimer = (handler: () => void, time: number): (() => void) => {
  // 计算分组ID：将时间（ms）转换为基础间隔的倍数
  const groupId = Math.round(time / FRAME_INTERVAL)

  // 获取或创建该分组的回调函数集合
  const fns = handlerMap.get(groupId) ?? new Set()
  fns.add(handler)
  handlerMap.set(groupId, fns)

  // 如果这是第一个任务，启动 Worker
  if (handlerMap.size === 1 && fns.size === 1) {
    worker?.postMessage({ event: 'start' })
  }

  // 返回清理函数
  return () => {
    // 从集合中移除该回调
    fns.delete(handler)

    // 如果该分组没有回调了，删除该分组
    if (fns.size === 0) handlerMap.delete(groupId)

    // 如果没有任何任务了，停止 Worker 并重置计数器
    if (handlerMap.size === 0) {
      runCount = 0
      worker?.postMessage({ event: 'stop' })
    }
  }
}

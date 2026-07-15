import { computed, ref } from 'vue'
import type { JobRuntime } from './JobRuntime'

/**
 * TaskCenter MVP 的最小数据流。
 *
 * 它只订阅 JobRuntime 的 ResourceEvent，并把当前 DAG 投影成响应式 taskViews。
 * 真正的执行、取消仍回到 JobRuntime；这里不保存第二份任务状态。
 */
export function useJobTaskCenter(runtime: JobRuntime) {
  const revision = ref(0)

  const unsubscribe = runtime.onResourceEvent(() => {
    revision.value += 1
  })

  const taskViews = computed(() => {
    // 让 computed 依赖 revision。ResourceNode 真相仍由 runtime 持有。
    revision.value
    return runtime.getTaskViews()
  })

  function cancelTask(rootResourceId: string): Promise<boolean> {
    return runtime.cancel(rootResourceId)
  }

  return {
    taskViews,
    cancelTask,
    dispose: unsubscribe,
  }
}

import { ref, computed, nextTick } from 'vue'
import { useUnifiedStore } from '@/core/unifiedStore'
import type { UnifiedTrackType } from '@/core/track/TrackTypes'

/**
 * 时间轴轨道管理模块
 * 提供时间轴轨道相关的管理功能，包括添加、删除、重命名、切换可见性等
 */
export function useTimelineTrackManagement() {
  const unifiedStore = useUnifiedStore()

  // 轨道列表
  const tracks = computed(() => unifiedStore.tracks)

  // 编辑轨道名称相关
  const editingTrackId = ref<string | null>(null)
  const editingTrackName = ref('')
  // 为每个轨道使用单独的ref，避免多轨道间引用冲突
  const nameInputs = ref<Record<string, HTMLInputElement>>({})

  /**
   * 添加新轨道
   * @param type 轨道类型
   * @param afterTrackId 在界面上指定轨道下方添加（可选）
   */
  async function addNewTrack(type: UnifiedTrackType = 'video', afterTrackId?: string) {
    try {
      if (afterTrackId) {
        // 找到目标轨道的位置
        const afterTrackIndex = tracks.value.findIndex((track) => track.id === afterTrackId)
        if (afterTrackIndex === -1) {
          console.error('❌ 找不到目标轨道:', afterTrackId)
          return
        }

        // tracks 按底层到顶层保存；界面下方对应数组中的前一个位置。
        await unifiedStore.addTrackWithHistory(type, afterTrackIndex)
        console.log('✅ 轨道添加成功，类型:', type, '位置:', afterTrackIndex)
      } else {
        // 在末尾添加新轨道
        await unifiedStore.addTrackWithHistory(type)
        console.log('✅ 轨道添加成功，类型:', type)
      }

      // 显示成功提示
      if (type === 'text') {
        unifiedStore.messageSuccess('文本轨道创建成功！现在可以右键点击轨道添加文本内容。')
      } else if (type === 'audio') {
        unifiedStore.messageSuccess('音频轨道创建成功！现在可以拖拽音频文件到轨道中。')
      } else if (type === 'video') {
        unifiedStore.messageSuccess('视频轨道创建成功！现在可以拖拽视频文件到轨道中。')
      }
    } catch (error) {
      console.error('❌ 添加轨道时出错:', error)
      unifiedStore.messageError(`添加轨道失败：${(error as Error).message}`)
    }
  }

  /**
   * 切换轨道可见性
   * @param trackId 轨道ID
   */
  async function toggleVisibility(trackId: string) {
    try {
      await unifiedStore.toggleTrackVisibilityWithHistory(trackId)
      console.log('✅ 轨道可见性切换成功')
    } catch (error) {
      console.error('❌ 切换轨道可见性时出错:', error)
    }
  }

  /**
   * 切换轨道静音状态
   * @param trackId 轨道ID
   */
  async function toggleMute(trackId: string) {
    try {
      await unifiedStore.toggleTrackMuteWithHistory(trackId)
      console.log('✅ 轨道静音状态切换成功')
    } catch (error) {
      console.error('❌ 切换轨道静音状态时出错:', error)
    }
  }

  /**
   * 自动排列轨道上的片段
   * @param trackId 轨道ID
   */
  async function autoArrangeTrack(trackId: string) {
    try {
      await unifiedStore.autoArrangeTrackWithHistory(trackId)
      console.log('✅ 轨道自动排列成功')
    } catch (error) {
      console.error('❌ 自动排列轨道时出错:', error)
    }
  }

  /**
   * 开始重命名轨道
   * @param track 轨道对象
   */
  async function startRename(track: { id: string; name: string }) {
    editingTrackId.value = track.id
    editingTrackName.value = track.name
    await nextTick()

    // 使用轨道ID作为key获取对应的输入框
    const input = nameInputs.value[track.id]
    if (input && typeof input.focus === 'function') {
      input.focus()
      input.select()
    } else {
      console.warn(`无法获取到轨道 ${track.id} 的输入框引用`)
    }
  }

  /**
   * 完成重命名轨道
   */
  async function finishRename() {
    if (editingTrackId.value && editingTrackName.value.trim()) {
      try {
        await unifiedStore.renameTrackWithHistory(
          editingTrackId.value,
          editingTrackName.value.trim(),
        )
        console.log('✅ 轨道重命名成功')
      } catch (error) {
        console.error('❌ 重命名轨道时出错:', error)
      }
    }
    // 清理输入框引用
    if (editingTrackId.value) {
      delete nameInputs.value[editingTrackId.value]
    }
    editingTrackId.value = null
    editingTrackName.value = ''
  }

  /**
   * 取消重命名轨道
   */
  function cancelRename() {
    // 清理输入框引用
    if (editingTrackId.value) {
      delete nameInputs.value[editingTrackId.value]
    }
    editingTrackId.value = null
    editingTrackName.value = ''
  }

  /**
   * 删除轨道
   * @param trackId 轨道ID
   */
  async function removeTrack(trackId: string) {
    try {
      // 检查轨道是否存在
      const track = tracks.value.find((t) => t.id === trackId)
      if (!track) {
        console.error('❌ 找不到要删除的轨道:', trackId)
        return
      }

      // 使用带历史记录的删除方法
      await unifiedStore.removeTrackWithHistory(trackId)
      console.log('✅ 轨道删除成功:', trackId)
    } catch (error) {
      console.error('❌ 删除轨道时出错:', error)
      unifiedStore.messageError(`删除轨道失败：${(error as Error).message}`)
    }
  }

  /**
   * 获取指定轨道的时间轴项目
   * @param trackId 轨道ID
   * @returns 时间轴项目数组
   */
  function getClipsForTrack(trackId: string) {
    return unifiedStore.getTimelineItemsByTrack(trackId)
  }

  return {
    // 状态
    tracks,
    editingTrackId,
    editingTrackName,
    nameInputs,

    // 方法
    addNewTrack,
    toggleVisibility,
    toggleMute,
    autoArrangeTrack,
    startRename,
    finishRename,
    cancelRename,
    removeTrack,
    getClipsForTrack,
  }
}

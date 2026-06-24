import { useMessage, useNotification } from 'naive-ui'
import { createVNode, render, ref, watchEffect, nextTick, h, type VNode, type Component } from 'vue'
import UniversalModal from '@/components/modals/UniversalModal.vue'
import LoadingModal from '@/components/base/LoadingModal.vue'

const TEMP_FOCUS_DEBUG_PREFIX = '[LC_TEMP_FOCUS_DEBUG][Notify]'

/**
 * 自定义 Modal 配置选项
 */
export interface CustomModalOptions {
  title?: string
  content?: string | VNode | (() => VNode)
  width?: string
  maxWidth?: string
  maxHeight?: string
  showClose?: boolean
  showFooter?: boolean
  showCancel?: boolean
  showConfirm?: boolean
  confirmText?: string
  cancelText?: string
  confirmDisabled?: boolean
  loading?: boolean
  closable?: boolean
  maskClosable?: boolean
  escClosable?: boolean
  zIndex?: number
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
  onClose?: () => void
}

/**
 * Loading Modal 配置选项
 */
export interface LoadingOptions {
  /** 加载标题 */
  title?: string
  /** 当前加载阶段 */
  stage?: string
  /** 加载进度 (0-100) */
  progress?: number
  /** 详细信息 */
  details?: string
  /** 提示文本 */
  tipText?: string
  /** 是否显示标题 */
  showTitle?: boolean
  /** 是否显示阶段 */
  showStage?: boolean
  /** 是否显示进度条 */
  showProgress?: boolean
  /** 是否显示详细信息 */
  showDetails?: boolean
  /** 是否显示提示信息 */
  showTips?: boolean
  /** 是否显示取消按钮 */
  showCancel?: boolean
  /** 取消按钮文本 */
  cancelText?: string
  /** 取消回调 */
  onCancel?: () => void
}

/**
 * Loading Modal 更新选项
 */
export interface LoadingUpdateOptions {
  /** 当前加载阶段 */
  stage?: string
  /** 加载进度 (0-100) */
  progress?: number
  /** 详细信息 */
  details?: string
  /** 提示文本 */
  tipText?: string
}

/**
 * Loading Modal 实例接口
 */
export interface LoadingInstance {
  /** 更新加载状态 */
  update: (options: LoadingUpdateOptions) => void
  /** 关闭加载弹窗 */
  close: () => void
}

/**
 * 系统通知选项（精简版）
 */
export interface SystemNotificationOptions {
  /** 通知标题（必填） */
  title: string
  /** 通知内容（可选） */
  body?: string
}

/**
 * 统一通知管理模块
 * 负责管理应用内的通知显示和管理
 */
export function createUnifiedUseNaiveUIModule() {
  // ==================== 状态定义 ====================

  let naiveUIMessage: ReturnType<typeof useMessage> | null = null
  let t: ((key: string) => string) | null = null

  // 自定义 Modal 的 z-index 计数器
  let zIndexCounter = 1000

  // ==================== 公共方法 ====================

  /**
   * 显示成功通知
   */
  function messageSuccess(message: string): void {
    if (!naiveUIMessage) {
      console.warn('naiveUIMessage 未初始化')
      return
    }

    naiveUIMessage.success(message)
  }

  /**
   * 显示错误通知
   */
  function messageError(message: string): void {
    if (!naiveUIMessage) {
      console.warn('naiveUIMessage 未初始化')
      return
    }

    naiveUIMessage.error(message)
  }

  /**
   * 显示警告通知
   */
  function messageWarning(message: string): void {
    if (!naiveUIMessage) {
      console.warn('naiveUIMessage 未初始化')
      return
    }

    naiveUIMessage.warning(message)
  }

  /**
   * 显示信息通知
   */
  function messageInfo(message: string): void {
    if (!naiveUIMessage) {
      console.warn('naiveUIMessage 未初始化')
      return
    }

    naiveUIMessage.info(message)
  }

  /**
   * Naive UI DialogOptions 兼容接口
   */
  interface DialogOptions {
    title?: string
    content?: string | (() => VNode)
    positiveText?: string
    negativeText?: string
    onPositiveClick?: () => void | Promise<void>
    onNegativeClick?: () => void
    closable?: boolean
    maskClosable?: boolean
    [key: string]: any
  }

  /**
   * 显示成功对话框（使用 createModal 实现）
   */
  function dialogSuccess(options: DialogOptions): void {
    if (!t) {
      console.warn('i18n t function not initialized')
      return
    }
    createModal({
      title: options.title || t('dialog.success'),
      content: typeof options.content === 'function'
        ? options.content
        : options.content
          ? () => h('div', {
              style: {
                padding: '10px 0',
                color: 'var(--color-text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: '1.6'
              }
            }, options.content as string)
          : undefined,
      confirmText: options.positiveText || t('dialog.confirm'),
      cancelText: options.negativeText || t('dialog.cancel'),
      showCancel: !!options.negativeText,
      closable: options.closable !== false,
      maskClosable: options.maskClosable !== false,
      onConfirm: options.onPositiveClick,
      onCancel: options.onNegativeClick,
    })
  }

  /**
   * 显示错误对话框（使用 createModal 实现）
   */
  function dialogError(options: DialogOptions): void {
    if (!t) {
      console.warn('i18n t function not initialized')
      return
    }
    createModal({
      title: options.title || t('dialog.error'),
      content: typeof options.content === 'function'
        ? options.content
        : options.content
          ? () => h('div', {
              style: {
                padding: '10px 0',
                color: '#ff6b6b',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: '1.6'
              }
            }, options.content as string)
          : undefined,
      confirmText: options.positiveText || t('dialog.confirm'),
      cancelText: options.negativeText || t('dialog.cancel'),
      showCancel: !!options.negativeText,
      closable: options.closable !== false,
      maskClosable: options.maskClosable !== false,
      onConfirm: options.onPositiveClick,
      onCancel: options.onNegativeClick,
    })
  }

  /**
   * 显示警告对话框（使用 createModal 实现）
   */
  function dialogWarning(options: DialogOptions): void {
    if (!t) {
      console.warn('i18n t function not initialized')
      return
    }
    createModal({
      title: options.title || t('dialog.warning'),
      content: typeof options.content === 'function'
        ? options.content
        : options.content
          ? () => h('div', {
              style: {
                padding: '10px 0',
                color: 'var(--color-text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: '1.6'
              }
            }, options.content as string)
          : undefined,
      confirmText: options.positiveText || t('dialog.confirm'),
      cancelText: options.negativeText || t('dialog.cancel'),
      showCancel: !!options.negativeText,
      closable: options.closable !== false,
      maskClosable: options.maskClosable !== false,
      onConfirm: options.onPositiveClick,
      onCancel: options.onNegativeClick,
    })
  }

  /**
   * 显示信息对话框（使用 createModal 实现）
   */
  function dialogInfo(options: DialogOptions): void {
    if (!t) {
      console.warn('i18n t function not initialized')
      return
    }
    createModal({
      title: options.title || t('dialog.info'),
      content: typeof options.content === 'function'
        ? options.content
        : options.content
          ? () => h('div', {
              style: {
                padding: '10px 0',
                color: 'var(--color-text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: '1.6'
              }
            }, options.content as string)
          : undefined,
      confirmText: options.positiveText || t('dialog.confirm'),
      cancelText: options.negativeText || t('dialog.cancel'),
      showCancel: !!options.negativeText,
      closable: options.closable !== false,
      maskClosable: options.maskClosable !== false,
      onConfirm: options.onPositiveClick,
      onCancel: options.onNegativeClick,
    })
  }

  /**
   * 创建自定义模态框（使用 UniversalModal 组件）
   */
  function createModal(options: CustomModalOptions) {
    const currentZIndex = options.zIndex || zIndexCounter++

    // 创建容器
    const container = document.createElement('div')
    document.body.appendChild(container)

    // 控制显示状态（使用 ref 使其响应式）
    // 先设置为 false，然后在下一帧设置为 true，以触发进入动画
    const show = ref(false)

    // 销毁函数
    const destroy = () => {
      show.value = false
      // 延迟销毁，等待动画完成（UniversalModal 的动画是 0.2s）
      setTimeout(() => {
        render(null, container)
        if (document.body.contains(container)) {
          document.body.removeChild(container)
        }
        if (!options.zIndex) {
          zIndexCounter-- // 关闭时减少计数
        }
      }, 300)
    }

    // 处理确认
    const handleConfirm = async () => {
      if (options.onConfirm) {
        await options.onConfirm()
      }
      destroy()
    }

    // 处理取消
    const handleCancel = () => {
      if (options.onCancel) {
        options.onCancel()
      }
      destroy()
    }

    // 处理关闭
    const handleClose = () => {
      if (options.onClose) {
        options.onClose()
      }
      destroy()
    }

    // 使用 watchEffect 来响应式地更新 VNode
    watchEffect(() => {
      const vnode = createVNode(UniversalModal, {
        show: show.value,
        title: options.title,
        width: options.width,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        showClose: options.showClose !== false,
        showFooter: options.showFooter !== false,
        showCancel: options.showCancel !== false,
        showConfirm: options.showConfirm !== false,
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
        confirmDisabled: options.confirmDisabled,
        loading: options.loading,
        closable: options.closable !== false,
        maskClosable: options.maskClosable !== false,
        escClosable: options.escClosable !== false,
        zIndex: currentZIndex,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
        onClose: handleClose,
        'onUpdate:show': (value: boolean) => {
          if (!value) {
            destroy()
          }
        },
      },
      // 默认插槽：内容
      typeof options.content === 'function'
        ? { default: options.content }
        : options.content
          ? { default: () => options.content }
          : undefined
      )

      // 渲染
      render(vnode, container)
    })

    // 在下一帧显示 modal，触发进入动画
    nextTick(() => {
      show.value = true
    })

    return { destroy }
  }

  /**
   * 销毁所有模态框（重置计数器）
   */
  function destroyAllModals(): void {
    // 移除所有自定义 modal 容器
    const modals = document.querySelectorAll('.custom-modal-overlay')
    modals.forEach((modal) => {
      const container = modal.parentElement
      if (container) {
        render(null, container)
        document.body.removeChild(container)
      }
    })
    zIndexCounter = 1000
  }

  /**
   * 创建加载弹窗
   */
  function createLoading(options: LoadingOptions = {}): LoadingInstance {
    // 创建容器
    const container = document.createElement('div')
    document.body.appendChild(container)

    // 响应式状态
    const visible = ref(false)
    const stage = ref(options.stage)
    const progress = ref(options.progress)
    const details = ref(options.details)
    const tipText = ref(options.tipText)

    // 销毁函数
    const destroy = () => {
      visible.value = false
      // 延迟销毁，等待动画完成（LoadingModal 的动画是 0.2s）
      setTimeout(() => {
        render(null, container)
        if (document.body.contains(container)) {
          document.body.removeChild(container)
        }
      }, 300)
    }

    // 处理取消
    const handleCancel = () => {
      if (options.onCancel) {
        options.onCancel()
      }
      destroy()
    }

    // 使用 watchEffect 响应式渲染
    watchEffect(() => {
      const vnode = createVNode(LoadingModal, {
        visible: visible.value,
        title: options.title,
        stage: stage.value,
        progress: progress.value,
        details: details.value,
        tipText: tipText.value,
        showTitle: options.showTitle !== false,
        showStage: options.showStage !== false,
        showProgress: options.showProgress !== false,
        showDetails: options.showDetails !== false,
        showTips: options.showTips !== false,
        showCancel: options.showCancel !== false,
        cancelText: options.cancelText,
        onCancel: handleCancel,
      })

      render(vnode, container)
    })

    // 下一帧显示，触发动画
    nextTick(() => {
      visible.value = true
    })

    // 返回实例方法
    return {
      update: (updateOptions: LoadingUpdateOptions) => {
        if (updateOptions.stage !== undefined) stage.value = updateOptions.stage
        if (updateOptions.progress !== undefined) progress.value = updateOptions.progress
        if (updateOptions.details !== undefined) details.value = updateOptions.details
        if (updateOptions.tipText !== undefined) tipText.value = updateOptions.tipText
      },
      close: destroy,
    }
  }

  // ==================== 系统通知管理（极简版） ====================

  /**
   * 发送系统通知（极简版）
   * - 静默推送（不发出声音）
   * - 5秒后自动关闭
   * - 点击通知聚焦回网页
   *
   * @param title 通知标题
   * @param body 通知内容（可选）
   * @returns Promise<boolean> 是否发送成功
   */
  async function notifySystem(title: string, body?: string): Promise<boolean> {
    // 检查浏览器支持
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false
    }

    console.log(`${TEMP_FOCUS_DEBUG_PREFIX} notifySystem called`, {
      title,
      body,
      permission: Notification.permission,
      documentVisibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
      hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false,
      timestamp: new Date().toISOString(),
    })

    // 检查权限
    let permission = Notification.permission

    // 如果权限未决定，尝试请求
    if (permission === 'default') {
      try {
        console.warn(`${TEMP_FOCUS_DEBUG_PREFIX} requestPermission about to run`, {
          title,
          documentVisibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
          hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false,
        })
        permission = await Notification.requestPermission()
        console.warn(`${TEMP_FOCUS_DEBUG_PREFIX} requestPermission resolved`, {
          title,
          permission,
          documentVisibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
          hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false,
        })
      } catch (error) {
        console.error('请求系统通知权限失败:', error)
        return false
      }
    }

    // 如果没有权限，静默失败
    if (permission !== 'granted') {
      return false
    }

    try {
      // 创建通知
      const notification = new Notification(title, {
        body: body,
        silent: true,  // 静默推送，不发出声音
        icon: '/logo-ok/favicon-96x96.png',  // 使用应用图标
      })

      console.log(`${TEMP_FOCUS_DEBUG_PREFIX} notification created`, {
        title,
        documentVisibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        hasFocus: typeof document !== 'undefined' ? document.hasFocus() : false,
      })

      // 点击通知时聚焦回网页
      notification.onclick = () => {
        console.warn(`${TEMP_FOCUS_DEBUG_PREFIX} notification onclick -> window.focus()`, {
          title,
          documentVisibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
          hasFocusBeforeFocusCall: typeof document !== 'undefined' ? document.hasFocus() : false,
          timestamp: new Date().toISOString(),
        })
        window.focus()
        notification.close()
      }

      return true
    } catch (error) {
      console.error('发送系统通知失败:', error)
      return false
    }
  }

  function initApi(api: {
    message: ReturnType<typeof useMessage>
    t?: (key: string) => string
  }) {
    naiveUIMessage = api.message
    if (api.t) {
      t = api.t
    }
  }
  // ==================== 导出接口 ====================

  return {
    initApi,
    // 便捷通知方法
    messageSuccess,
    messageError,
    messageWarning,
    messageInfo,
    // 便捷对话框方法
    dialogSuccess,
    dialogError,
    dialogWarning,
    dialogInfo,
    // 便捷模态框方法
    createModal,
    destroyAllModals,
    // 加载弹窗方法
    createLoading,
    // 系统通知方法
    notifySystem,
  }
}

// 导出类型定义
export type UnifiedUseNaiveUIModule = ReturnType<typeof createUnifiedUseNaiveUIModule>

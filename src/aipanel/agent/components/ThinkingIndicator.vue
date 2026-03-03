<template>
  <div class="thinking-indicator">
    <span class="dot dot-1"></span>
    <span class="dot dot-2"></span>
    <span class="dot dot-3"></span>
    <span class="dot dot-4"></span>
    <span class="dot dot-5"></span>
  </div>
</template>

<script setup lang="ts">
// AI 正在思考指示器组件
// 显示5个白色点轮流闪动的动画
</script>

<style scoped>
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border-radius: 12px;
  width: fit-content;
}

.thinking-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #ffffff;
  animation: dot-bounce 1.4s infinite ease-in-out both;
}

.thinking-indicator .dot-1 {
  animation-delay: -0.32s;
}

.thinking-indicator .dot-2 {
  animation-delay: -0.16s;
}

.thinking-indicator .dot-3 {
  animation-delay: 0s;
}

.thinking-indicator .dot-4 {
  animation-delay: 0.16s;
}

.thinking-indicator .dot-5 {
  animation-delay: 0.32s;
}

@keyframes dot-bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>

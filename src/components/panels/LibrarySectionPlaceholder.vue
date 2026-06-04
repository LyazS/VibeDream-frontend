<template>
  <div class="library-section-placeholder">
    <div class="library-section-placeholder__icon">
      <component :is="icon" size="24px" />
    </div>
    <h3 class="library-section-placeholder__title">{{ title }}</h3>
    <p class="library-section-placeholder__description">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: unknown
  title: string
  description: string
}>()
</script>

<style scoped>
.library-section-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
  color: var(--color-text-secondary);
  background:
    radial-gradient(circle at top, rgba(0, 208, 255, 0.08), transparent 40%),
    var(--color-bg-secondary);
}

.library-section-placeholder__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(0, 208, 255, 0.12);
  color: var(--color-accent-primary);
}

.library-section-placeholder__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.library-section-placeholder__description {
  margin: 0;
  max-width: 320px;
  line-height: 1.6;
  font-size: 13px;
}
</style>

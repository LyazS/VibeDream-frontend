<template>
  <div class="asset-library-panel">
    <VirtualDirectory />
  </div>
</template>

<script setup lang="ts">
import VirtualDirectory from './VirtualDirectory.vue'
</script>

<style scoped>
.asset-library-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}
</style>

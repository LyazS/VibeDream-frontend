<template>
  <LibrarySidebarShell>
    <template #sidebar>
      <LibraryVerticalTabs />
    </template>
    <LibraryMediaGrid />
  </LibrarySidebarShell>
</template>

<script setup lang="ts">
import LibrarySidebarShell from './LibrarySidebarShell.vue'
import LibraryVerticalTabs from './LibraryVerticalTabs.vue'
import LibraryMediaGrid from './LibraryMediaGrid.vue'
</script>

<template>
  <div class="library-sidebar-shell">
    <div class="library-sidebar-shell__content">
      <div class="library-sidebar-shell__sidebar">
        <slot name="sidebar" />
      </div>
      <div class="library-sidebar-shell__main">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.library-sidebar-shell {
  width: 100%;
  height: 100%;
  background-color: var(--color-bg-secondary);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  position: relative;
}

.library-sidebar-shell__content {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  position: relative;
}

.library-sidebar-shell__sidebar {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 100;
}

.library-sidebar-shell__main {
  flex: 1;
  min-width: 0;
  margin-left: 38px;
  overflow: hidden;
}
</style>

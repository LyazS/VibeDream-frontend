<template>
  <div class="modal-form-field">
    <component
      :is="inputId ? 'label' : 'div'"
      v-if="label"
      class="modal-form-field__label"
      :for="inputId"
    >
      {{ label }}
    </component>
    <slot />
    <div v-if="$slots.hint" class="modal-form-field__hint">
      <slot name="hint" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  label?: string
  inputId?: string
}

defineProps<Props>()
</script>

<style scoped>
.modal-form-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.modal-form-field__label {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.modal-form-field :deep(input:not([type='radio'])),
.modal-form-field :deep(textarea),
.modal-form-field :deep(select) {
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-bg-hover);
  border-radius: var(--border-radius-small);
  background-color: var(--color-bg-secondary);
  color: var(--color-text-primary);
  caret-color: var(--color-text-primary);
  font: inherit;
  font-size: var(--font-size-sm);
  transition-property: background-color, border-color, box-shadow, transform;
  transition-duration: var(--transition-fast);
  transition-timing-function: ease-out;
}

.modal-form-field :deep(input:not([type='radio']):hover),
.modal-form-field :deep(textarea:hover),
.modal-form-field :deep(select:hover) {
  background-color: var(--color-bg-hover);
}

.modal-form-field :deep(input:not([type='radio']):focus),
.modal-form-field :deep(textarea:focus),
.modal-form-field :deep(select:focus) {
  outline: none;
  border-color: transparent;
  background-color: var(--color-bg-hover);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 4px 10px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.modal-form-field :deep(textarea) {
  min-height: 80px;
  resize: vertical;
}

.modal-form-field :deep(select) {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ffffff' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--spacing-lg) center;
  padding-right: calc(var(--spacing-xxl) + var(--spacing-lg));
}

.modal-form-field :deep(input::placeholder),
.modal-form-field :deep(textarea::placeholder) {
  color: var(--color-text-tertiary);
}

.modal-form-field__hint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.4;
}
</style>

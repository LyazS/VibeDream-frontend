import NumberField from './NumberField.vue'
import TextareaField from './TextareaField.vue'
import SelectField from './SelectField.vue'
import FileInputField from './FileInputField.vue'

export const FIELD_COMPONENT_MAP = {
  'number-input': NumberField,
  'textarea-input': TextareaField,
  'select-input': SelectField,
  'file-input': FileInputField,
} as const

export type FieldType = keyof typeof FIELD_COMPONENT_MAP

export { NumberField, TextareaField, SelectField, FileInputField }
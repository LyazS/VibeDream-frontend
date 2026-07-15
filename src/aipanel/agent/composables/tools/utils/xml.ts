export type XmlAttributeValue = string | number | boolean | undefined

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildXmlAttributes(
  attributes: Array<[string, XmlAttributeValue]>,
): string {
  return attributes
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${escapeXmlAttribute(String(value))}"`)
    .join(' ')
}

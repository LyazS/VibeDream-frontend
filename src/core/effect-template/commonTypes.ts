export type CommonEffectType = 'transition' | 'filter'

export type CommonEffectTemplateStatus =
  | 'remote'
  | 'installing'
  | 'installed'
  | 'loading'
  | 'ready'
  | 'error'
  | 'missing'

export type EffectInstallPhase =
  | 'idle'
  | 'downloading'
  | 'writing'
  | 'validating'
  | 'ready'
  | 'error'

export interface EffectPackageIdentity {
  effectType: CommonEffectType
  templateId: string
  packageVersion: string
  catalogVersion: string
  effectPackageId: string
}

export function assertCatalogVersion(catalogVersion: string): string {
  const normalized = catalogVersion.trim()
  if (!normalized) {
    throw new Error('catalogVersion 不能为空')
  }
  return normalized
}

export function toCatalogVersionPathSegment(catalogVersion: string): string {
  return encodeURIComponent(assertCatalogVersion(catalogVersion))
}

export function fromCatalogVersionPathSegment(pathSegment: string): string {
  return assertCatalogVersion(decodeURIComponent(pathSegment))
}

export function assertPackageVersion(packageVersion: string): string {
  const normalized = packageVersion.trim()
  if (!normalized) {
    throw new Error('packageVersion 不能为空')
  }
  return normalized
}

export function toPackageVersionPathSegment(packageVersion: string): string {
  return encodeURIComponent(assertPackageVersion(packageVersion))
}

export function fromPackageVersionPathSegment(pathSegment: string): string {
  return assertPackageVersion(decodeURIComponent(pathSegment))
}

export function buildEffectPackageId(
  effectType: CommonEffectType,
  templateId: string,
  packageVersion: string,
): string {
  return `${effectType}/${templateId}@${assertPackageVersion(packageVersion)}`
}

export function parseEffectPackageId(effectPackageId: string): EffectPackageIdentity {
  const normalized = effectPackageId.trim()
  const slashIndex = normalized.indexOf('/')
  const atIndex = normalized.lastIndexOf('@')

  if (slashIndex <= 0 || atIndex <= slashIndex + 1 || atIndex === normalized.length - 1) {
    throw new Error(`无效的 effectPackageId: ${effectPackageId}`)
  }

  const effectType = normalized.slice(0, slashIndex)
  if (effectType !== 'transition' && effectType !== 'filter') {
    throw new Error(`未知的 effectType: ${effectType}`)
  }

  const templateId = normalized.slice(slashIndex + 1, atIndex).trim()
  if (!templateId) {
    throw new Error(`无效的 templateId: ${effectPackageId}`)
  }

  const packageVersion = assertPackageVersion(normalized.slice(atIndex + 1))

  return {
    effectType,
    templateId,
    packageVersion,
    catalogVersion: '',
    effectPackageId: normalized,
  }
}

/**
 * 解析后的路径信息
 */
export interface ParsedPath {
  /** 目录路径 */
  dir: string
  /** 文件名（包含扩展名） */
  base: string
  /** 扩展名（包含点） */
  ext: string
  /** 文件名（不包含扩展名） */
  name: string
}

/**
 * 工作空间信息
 */
export interface WorkspaceInfo {
  /** 工作空间名称 */
  name: string
  /** 工作空间路径（可选，某些适配器可能不提供） */
  path?: string
  /** 是否允许用户重新选择工作目录；未提供时沿用可选择目录的行为。 */
  canChangeWorkspace?: boolean
}

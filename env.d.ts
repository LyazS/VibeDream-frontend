/// <reference types="vite/client" />

declare module '*.vert?raw' {
  const source: string
  export default source
}

declare module '*.frag?raw' {
  const source: string
  export default source
}

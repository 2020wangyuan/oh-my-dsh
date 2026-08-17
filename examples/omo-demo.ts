// omo-demo.ts —— OmO DSH 演示文件（已通过 hashline / omo_comments 清理并验证）

export function add(a: number, b: number): number {
  return a + b
}

export function greet(name: string): string {
  return `Hello, ${name}`
}

export function separator(): void {
  // separator 故意为空：保留为模块内省略占位
}

// 真实有用的注释：解释下面的行为 —— 合法注释不应被标记
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

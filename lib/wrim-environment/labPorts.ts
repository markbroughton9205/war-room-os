/**
 * Canonical WRIM laboratory loopback ports. Do not assign ports in scripts ad hoc.
 * Forbidden: 3000, 3001, 3847, 3848, 11434.
 */
export const WRIM_LAB_BIND = '127.0.0.1' as const

export const WRIM_LAB_PORTS = {
  aim: 43880,
  tensorboard: 43881,
  mlflow: 43882,
  prometheus: 43883,
  wrim_exporter: 43884,
} as const

export const WRIM_LAB_FORBIDDEN_PORTS = [3000, 3001, 3847, 3848, 11434] as const

export type WrimLabServiceName = keyof typeof WRIM_LAB_PORTS

export function wrimLabOrigin(service: WrimLabServiceName): string {
  return `http://${WRIM_LAB_BIND}:${WRIM_LAB_PORTS[service]}`
}

export function wrimLabPortCollision(port: number): boolean {
  return (WRIM_LAB_FORBIDDEN_PORTS as readonly number[]).includes(port)
}

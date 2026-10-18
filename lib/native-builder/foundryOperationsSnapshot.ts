/** Share overlapping read snapshots only; the next poll always reads fresh state. */
export function createOperationsSnapshotReader<T>(read: (view: string) => Promise<T>) {
  const pending = new Map<string, Promise<T>>()
  return (view: string): Promise<T> => {
    const existing = pending.get(view)
    if (existing) return existing
    const snapshot = Promise.resolve().then(() => read(view)).finally(() => {
      if (pending.get(view) === snapshot) pending.delete(view)
    })
    pending.set(view, snapshot)
    return snapshot
  }
}

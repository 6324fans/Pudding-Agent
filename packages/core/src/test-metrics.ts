/**
 * Test module for observing context engine behavior
 */

export interface TestMetrics {
  timestamp: number
  operation: string
  duration: number
}

export function calculateMetrics(operations: TestMetrics[]): number {
  return operations.reduce((sum, op) => sum + op.duration, 0)
}

export function findSlowestOperation(metrics: TestMetrics[]): TestMetrics | undefined {
  if (metrics.length === 0) return undefined
  return metrics.reduce((slowest, current) => 
    current.duration > slowest.duration ? current : slowest
  )
}

export function generateReport(metrics: TestMetrics[]): string {
  const total = calculateMetrics(metrics)
  const slowest = findSlowestOperation(metrics)
  
  return [
    `Total operations: ${metrics.length}`,
    `Total duration: ${total}ms`,
    slowest ? `Slowest: ${slowest.operation} (${slowest.duration}ms)` : 'No operations',
  ].join('\n')
}

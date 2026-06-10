import type { ToolRegistry } from '../tool-registry.js'
import { bashTool } from './bash.js'
import { fileReadTool } from './file-read.js'
import { fileWriteTool } from './file-write.js'
import { fileEditTool } from './file-edit.js'
import { multiEditTool } from './multi-edit.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { lsTool } from './ls.js'
import { treeTool } from './tree.js'
import { notebookEditTool } from './notebook-edit.js'
import { webFetchTool } from './web-fetch.js'
import { webSearchTool } from './web-search.js'
import { weatherTool } from './weather.js'
import { createContextEngineTools } from './context-engine-tools.js'
import { createMemorySearchTool } from './memory-search.js'
import { createMemoryWriteTool } from './memory-write.js'
import { lspTool } from './lsp.js'
import { createPowerShellTool } from './powershell.js'
import { findGitBash, findPowerShell } from '../utils/shell-detection.js'
import { isWindows } from '../utils/platform.js'

export function registerBuiltinTools(registry: ToolRegistry): void {
  const onWindows = isWindows()
  const hasGitBash = onWindows ? !!findGitBash() : true

  if (hasGitBash) {
    registry.register(bashTool)
  }

  // Register PowerShell tool on Windows
  if (onWindows) {
    const psPath = findPowerShell()
    if (psPath) {
      const psTool = createPowerShellTool(psPath)
      registry.register(psTool)
    }
  }

  registry.register(fileReadTool)
  registry.register(fileWriteTool)
  registry.register(fileEditTool)
  registry.register(multiEditTool)
  registry.register(globTool)
  registry.register(grepTool)
  registry.register(lsTool)
  registry.register(treeTool)
  registry.register(notebookEditTool)
  registry.register(webFetchTool)
  registry.register(webSearchTool)
  registry.register(weatherTool)
  registry.register(lspTool)

  // Pudding Context Engine — native code intelligence and durable project memory.
  for (const tool of createContextEngineTools()) {
    registry.register(tool)
  }
  registry.register(createMemorySearchTool())
  registry.register(createMemoryWriteTool())
}

export { bashTool, fileReadTool, fileWriteTool, fileEditTool, multiEditTool, globTool, grepTool, lsTool, treeTool, notebookEditTool, webFetchTool, webSearchTool, weatherTool, lspTool }
export { createContextEngineTools } from './context-engine-tools.js'
export { createContextInspectTool } from './context-inspect.js'
export { createContextRefreshTool } from './context-refresh.js'
export { createMemorySearchTool } from './memory-search.js'
export { createMemoryWriteTool } from './memory-write.js'

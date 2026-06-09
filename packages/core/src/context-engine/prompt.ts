// System-prompt segment describing the built-in Pudding Context Engine tools.

export interface ContextEnginePromptSegment {
  segment: string
  cacheable: true
}

export function getContextEnginePromptSegment(): ContextEnginePromptSegment {
  return {
    cacheable: true,
    segment: [
      '## Pudding Context Engine（内置代码上下文引擎）',
      '',
      'Pudding Context Engine 是本地内置的只读代码索引能力，基于进程内 Tree-sitter 引擎，不依赖外部 MCP 服务或额外二进制。',
      '当用户询问架构、调用链、影响面、入口点、相关文件或“某个功能怎么实现”时，优先使用下面的 Context 工具获取证据，再结合文件内容回答。',
      '',
      '- `Context`：根据任务/问题一次性聚合入口符号、相关符号、关键源码和 Git 线索。',
      '- `ContextSearch`：按名称搜索项目符号，返回定义位置。',
      '- `ContextNode`：查看单个符号的位置、签名、调用者、被调用者，可选源码。',
      '- `ContextCallers` / `ContextCallees`：分别查看静态调用者和依赖。',
      '- `ContextImpact`：分析修改某个符号可能影响的上游调用面。',
      '- `ContextTrace`：追踪两个符号之间的静态调用路径。',
      '- `ContextExplore`：批量读取多个相关符号的源码片段。',
      '- `ContextFiles`：查看已索引的文件结构和符号数量。',
      '',
      '索引存放在项目本地 `.puddingagent/context-engine/`，支持 TS/TSX/JS/Python/Go/Rust/Java/C/C++/Ruby/PHP。',
      '调用图是静态、按名称解析的：遇到同名符号、动态派发、回调或接口实现时，必须用 file:line 和必要的源码阅读核实。',
      '凡是上下文内容可以用中文表达时，用中文展示；文件路径、符号名、代码片段保持原样。',
    ].join('\n'),
  }
}

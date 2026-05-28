package com.puddingagent.ide.handlers

import com.google.gson.JsonObject
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerImpl
import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.text.StringUtil
import com.intellij.openapi.vfs.LocalFileSystem

class DiagnosticsHandler {
    fun handle(params: JsonObject): Map<String, Any> {
        val filePaths = params.getAsJsonArray("filePaths")?.map { it.asString } ?: emptyList()
        val files = filePaths.map { filePath ->
            mapOf("filePath" to filePath, "diagnostics" to diagnosticsFor(filePath))
        }
        return mapOf("files" to files)
    }

    private fun diagnosticsFor(filePath: String): List<Map<String, Any?>> {
        return ReadAction.compute<List<Map<String, Any?>>, Throwable> {
            val virtualFile = LocalFileSystem.getInstance().findFileByPath(filePath) ?: return@compute emptyList()
            val project = findProject(filePath) ?: return@compute emptyList()
            val document = FileDocumentManager.getInstance().getDocument(virtualFile) ?: return@compute emptyList()

            DaemonCodeAnalyzerImpl.getHighlights(document, HighlightSeverity.INFORMATION, project)
                .filter { it.getSeverity().compareTo(HighlightSeverity.INFORMATION) >= 0 }
                .mapNotNull { info -> diagnosticFromHighlight(document, info) }
        }
    }

    private fun diagnosticFromHighlight(
        document: com.intellij.openapi.editor.Document,
        info: HighlightInfo
    ): Map<String, Any?>? {
        val message = info.description
            ?: info.toolTip?.let { StringUtil.stripHtml(it, true) }
            ?: return null
        val startOffset = info.actualStartOffset.coerceIn(0, document.textLength)
        val endOffset = info.actualEndOffset.coerceIn(startOffset, document.textLength)
        val startLine = document.getLineNumber(startOffset)
        val endLine = document.getLineNumber(endOffset)

        return mapOf(
            "message" to message,
            "severity" to severityName(info.getSeverity()),
            "range" to mapOf(
                "start" to mapOf("line" to startLine, "character" to startOffset - document.getLineStartOffset(startLine)),
                "end" to mapOf("line" to endLine, "character" to endOffset - document.getLineStartOffset(endLine))
            ),
            "source" to "JetBrains",
            "code" to info.inspectionToolId
        )
    }

    private fun severityName(severity: HighlightSeverity): String {
        return when {
            severity == HighlightSeverity.ERROR -> "error"
            severity == HighlightSeverity.WARNING || severity == HighlightSeverity.WEAK_WARNING -> "warning"
            severity == HighlightSeverity.INFORMATION || severity == HighlightSeverity.INFO -> "info"
            else -> "hint"
        }
    }

    private fun findProject(filePath: String): Project? {
        val normalized = filePath.replace('\\', '/')
        return ProjectManager.getInstance().openProjects.firstOrNull { project ->
            val basePath = project.basePath?.replace('\\', '/')
            basePath != null && normalized.startsWith(basePath)
        } ?: ProjectManager.getInstance().openProjects.firstOrNull()
    }
}

package com.puddingagent.ide.handlers

import com.google.gson.JsonObject
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
import java.awt.Dimension
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import javax.swing.AbstractAction
import javax.swing.Action
import javax.swing.JComponent

class DiffHandler {
    private val openDialogs = ConcurrentHashMap<String, PuddingDiffDialog>()

    fun handleOpenDiff(params: JsonObject): Map<String, Any?> {
        val filePath = params.get("filePath")?.asString ?: throw IllegalArgumentException("filePath required")
        val originalContent = params.get("originalContent")?.asString ?: ""
        val proposedContent = params.get("proposedContent")?.asString ?: ""
        val tabName = params.get("tabName")?.asString ?: "[Pudding-Agent] diff"
        val project = findProject(filePath) ?: throw IllegalStateException("No open project for diff")
        val result = CompletableFuture<Map<String, Any?>>()

        ApplicationManager.getApplication().invokeLater {
            val dialog = PuddingDiffDialog(project, filePath, tabName, originalContent, proposedContent) { actionResult ->
                result.complete(actionResult)
            }
            openDialogs[tabName] = dialog
            dialog.show()
            openDialogs.remove(tabName)
            if (!result.isDone) result.complete(mapOf("action" to "closed"))
        }

        return result.get()
    }

    fun handleCloseAllDiffTabs(): Map<String, Any> {
        val dialogs = openDialogs.values.toList()
        if (dialogs.isEmpty()) return mapOf("closed" to 0)

        ApplicationManager.getApplication().invokeLater {
            dialogs.forEach { it.close(DialogWrapper.CLOSE_EXIT_CODE) }
        }
        return mapOf("closed" to dialogs.size)
    }

    fun handleCloseTab(params: JsonObject): Map<String, Any> {
        val tabName = params.get("tabName")?.asString ?: return mapOf("success" to false)
        val dialog = openDialogs[tabName] ?: return mapOf("success" to false)

        ApplicationManager.getApplication().invokeLater {
            dialog.close(DialogWrapper.CLOSE_EXIT_CODE)
        }
        return mapOf("success" to true)
    }

    private fun findProject(filePath: String): Project? {
        val normalized = filePath.replace('\\', '/')
        return ProjectManager.getInstance().openProjects.firstOrNull { project ->
            val basePath = project.basePath?.replace('\\', '/')
            basePath != null && normalized.startsWith(basePath)
        } ?: ProjectManager.getInstance().openProjects.firstOrNull()
    }
}

private class PuddingDiffDialog(
    private val project: Project,
    private val filePath: String,
    private val tabName: String,
    private val originalContent: String,
    private val proposedContent: String,
    private val onResult: (Map<String, Any?>) -> Unit
) : DialogWrapper(project, true), Disposable {
    private val disposable = Disposer.newDisposable("Pudding-Agent diff: $tabName")
    private val diffPanel = DiffManager.getInstance().createRequestPanel(project, disposable, null)
    private var completed = false

    init {
        title = tabName
        setOKButtonText("Apply")
        setCancelButtonText("Close")
        setResizable(true)
        init()
        diffPanel.setRequest(createRequest())
    }

    override fun createCenterPanel(): JComponent {
        val component = diffPanel.component
        component.preferredSize = Dimension(1100, 720)
        return component
    }

    override fun createActions(): Array<Action> {
        return arrayOf(okAction, RejectAction(), cancelAction)
    }

    override fun doOKAction() {
        applyProposedContent()
        complete(mapOf("action" to "saved", "content" to proposedContent))
        super.doOKAction()
    }

    override fun doCancelAction() {
        complete(mapOf("action" to "closed"))
        super.doCancelAction()
    }

    override fun dispose() {
        complete(mapOf("action" to "closed"))
        Disposer.dispose(disposable)
        super<DialogWrapper>.dispose()
    }

    private fun createRequest(): SimpleDiffRequest {
        val virtualFile = LocalFileSystem.getInstance().findFileByPath(filePath)
        val factory = DiffContentFactory.getInstance()
        val original = if (virtualFile != null) {
            factory.create(project, originalContent, virtualFile)
        } else {
            factory.create(project, originalContent)
        }
        val proposed = if (virtualFile != null) {
            factory.create(project, proposedContent, virtualFile)
        } else {
            factory.create(project, proposedContent)
        }
        return SimpleDiffRequest(tabName, original, proposed, "Current", "Proposed")
    }

    private fun applyProposedContent() {
        val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByPath(filePath) ?: return
        val document = FileDocumentManager.getInstance().getDocument(virtualFile) ?: return

        WriteCommandAction.runWriteCommandAction(project, "Apply Pudding-Agent Diff", null, Runnable {
            document.setText(proposedContent)
            FileDocumentManager.getInstance().saveDocument(document)
        })
    }

    private fun complete(result: Map<String, Any?>) {
        if (completed) return
        completed = true
        onResult(result)
    }

    private inner class RejectAction : AbstractAction("Reject") {
        override fun actionPerformed(e: java.awt.event.ActionEvent?) {
            complete(mapOf("action" to "rejected"))
            close(NEXT_USER_EXIT_CODE)
        }
    }
}

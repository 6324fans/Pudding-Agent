package com.puddingagent.ide.server

import com.google.gson.JsonObject
import com.puddingagent.ide.handlers.OpenFileHandler
import com.puddingagent.ide.handlers.DiagnosticsHandler
import com.puddingagent.ide.handlers.DiffHandler
import com.puddingagent.ide.IdeProductInfo

class RpcHandler(
    private val authToken: String,
    private val productInfo: IdeProductInfo,
    private val openFileHandler: OpenFileHandler,
    private val diagnosticsHandler: DiagnosticsHandler,
    private val diffHandler: DiffHandler
) {
    fun handle(method: String, params: JsonObject): Any {
        return when (method) {
            "initialize" -> handleInitialize(params)
            "openFile" -> openFileHandler.handle(params)
            "openDiff" -> diffHandler.handleOpenDiff(params)
            "getDiagnostics" -> diagnosticsHandler.handle(params)
            "closeTab" -> diffHandler.handleCloseTab(params)
            "closeAllDiffTabs" -> diffHandler.handleCloseAllDiffTabs()
            else -> throw IllegalArgumentException("Unknown method: $method")
        }
    }

    private fun handleInitialize(params: JsonObject): Map<String, Any> {
        val token = params.get("authToken")?.asString
        if (token != authToken) throw SecurityException("Invalid auth token")
        return mapOf(
            "ideId" to productInfo.ideId,
            "ideName" to productInfo.ideName,
            "ideVersion" to productInfo.ideVersion,
            "capabilities" to listOf("openFile", "openDiff", "getDiagnostics", "selection", "atMention")
        )
    }
}

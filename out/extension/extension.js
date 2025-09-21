"use strict";
/*
 *  vscode-wolfram
 *
 *  Created by IDE support team on 10/01/24.
 *  Copyright (c) 2024 Wolfram Research. All rights reserved.
 *
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
const open = require('open');
const path = require('path');
const os = require('os');
const fs = require('fs');
const find_kernel_1 = require("./find-kernel");
const vscode = require("vscode");
const controller_1 = require("./controller");
const serializer_1 = require("./serializer");
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
const NOTEBOOK_TYPE = 'wolfram-notebook';
let extensionKernel = new find_kernel_1.FindKernel();
let client;
let wolframTmpDir;
let kernel_initialized = false;
let implicitTokensDecorationType = vscode.window.createTextEditorDecorationType({});
function activate(context) {
    const config = vscode.workspace.getConfiguration("wolfram", null);
    // Setup the menu
    context.subscriptions.push(vscode_1.commands.registerCommand('wolfram.OpenNotebook', (name) => { if (name) {
        open(name.fsPath);
    } }));
    context.subscriptions.push(vscode_1.commands.registerCommand('wolfram.DownloadWolframEngine', onDownloadWolframEngine));
    context.subscriptions.push(vscode.commands.registerCommand("wolfram.openConfigurations", async () => {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:WolframResearch.wolfram");
    }));
    let mainKernel = extensionKernel.resolveKernel();
    const download_WEngine_MDString = new vscode.MarkdownString(`[Download Wolfram Engine for kernel support.](https://www.wolfram.com/engine/)`);
    download_WEngine_MDString.supportHtml = true;
    download_WEngine_MDString.isTrusted = true;
    /*
        kernel setting is Automatic and kernel could not be found. As LSP and Notebook kernels
        are same as mainKernel, these kernels will also be missing. So no point of going further.
        Show error message here.
    */
    if (mainKernel === "kernel-not-found") {
        vscode.window.showErrorMessage("Kernel is not found in the default location. Either change \"System Kernel\" in the configuration or " + download_WEngine_MDString.value);
        return;
    }
    ;
    if (!fs.existsSync(mainKernel)) {
        vscode.window.showErrorMessage("Kernel executable path does not exist: " + mainKernel + ". Either change \"System Kernel\" in the configuration or " + download_WEngine_MDString.value);
        return;
    }
    // Add Terminal
    let terminalKernel = mainKernel;
    if (process.platform === "win32") {
        terminalKernel = terminalKernel.replace("WolframKernel.exe", "wolfram.exe");
    }
    ;
    context.subscriptions.push(vscode_1.commands.registerCommand('createWolframScriptTerminal', () => {
        // Reads systemKernel configuration value, and resolve the kernel
        // For defaulkt value, it will resolve to the actual path
        // For any kernel path is given in the configuration, it will be used
        const wolframscriptTerminal = vscode_1.window.createTerminal(`WolframKernel`, terminalKernel);
        wolframscriptTerminal.show();
    }));
    // Setup Notebook client
    let nbKernelenabled = config.get("notebook.kernelEnabled", true);
    let controller = new controller_1.WolframNotebookKernel();
    if (nbKernelenabled) {
        controller.launchKernel();
    }
    ;
    context.subscriptions.push(vscode_1.commands.registerCommand("wolfram.launchKernel", () => {
        if (nbKernelenabled) {
            client.outputChannel.appendLine("Launching Wolfram Kernel");
            controller.launchKernel();
        }
    }));
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer(NOTEBOOK_TYPE, new serializer_1.VSNBContentSerializer()), controller);
    // Setup LSP client
    let enabled = config.get("lsp.serverEnabled", true);
    if (!enabled) {
        return;
    }
    let lspcommand = config.get("advanced.lsp.command", ["lspKernel"]);
    let lspLog = config.get("advanced.lsp.ServerLogDirectory", "Off");
    // Set lspcommand to use standalone LSP app.
    // Use the default option to launch LSPServer
    if (lspcommand[0] == "lspKernel") {
        // No log directory is to be used
        if (lspLog == "Off") {
            lspcommand = [
                mainKernel,
                "-noinit",
                "-noprompt",
                "-nopaclet",
                "-noicon",
                "-nostartuppaclets",
                "-run",
                "Needs[\"LSPServer`\"];LSPServer`StartServer[]"
            ];
        }
        // log directory is a folder location, use that as the log folder
        else {
            lspcommand = [
                mainKernel,
                "-noinit",
                "-noprompt",
                "-nopaclet",
                "-noicon",
                "-nostartuppaclets",
                "-run",
                "Needs[\"LSPServer`\"]; LSPServer`$LogLevel = 1; LSPServer`StartServer[\"" + lspLog + "\"]"
            ];
        }
    }
    ;
    let implicitTokens = config.get("lsp.implicitTokens", []);
    let semanticTokens = config.get("lsp.semanticTokens", false);
    wolframTmpDir = path.join(os.tmpdir(), "Wolfram");
    //
    // recursive option suppresses any directory-already-exists error
    //
    fs.mkdirSync(wolframTmpDir, { recursive: true });
    let opts = {
        cwd: wolframTmpDir
    };
    let serverOptions = {
        run: {
            transport: node_1.TransportKind.stdio,
            command: lspcommand[0],
            args: lspcommand.slice(1),
            options: opts
        },
        debug: {
            transport: node_1.TransportKind.stdio,
            command: lspcommand[0],
            args: lspcommand.slice(1),
            options: opts
        }
    };
    let clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'wolfram' }],
        initializationOptions: {
            implicitTokens: implicitTokens,
            // bracketMatcher: bracketMatcher,
            // debugBracketMatcher: debugBracketMatcher
            semanticTokens: semanticTokens
        }
    };
    client = new node_1.LanguageClient('wolfram', 'Wolfram-LSP', serverOptions, clientOptions);
    // client.outputChannel.dispose();
    let timeoutWarningEnabled = config.get("timeout_warning_enabled", true);
    if (timeoutWarningEnabled) {
        setTimeout(kernel_initialization_check_function, 15000, lspcommand);
    }
    client.start().then(() => {
        //
        // client.onStart() is called after initialize response, so it is appropriate to set kernel_initialized here
        //
        kernel_initialized = true;
        client.onNotification("textDocument/publishImplicitTokens", (params) => {
            let activeEditor = vscode_1.window.activeTextEditor;
            if (!activeEditor) {
                return;
            }
            let opts = [];
            params.tokens.forEach((t) => {
                if (!activeEditor) {
                    return;
                }
                const opt = {
                    range: new vscode_1.Range(new vscode_1.Position(t.line - 1, t.column - 1), new vscode_1.Position(t.line - 1, t.column - 1)),
                    renderOptions: {
                        before: {
                            contentText: implicitTokenCharToText(t.character),
                            color: 'gray'
                        }
                    }
                };
                opts.push(opt);
            });
            activeEditor.setDecorations(implicitTokensDecorationType, opts);
        });
    });
}
exports.activate = activate;
function kernel_initialization_check_function(command) {
    if (kernel_initialized) {
        return;
    }
    let kernel = command[0];
    //
    // User knows that the kernel did not start properly, so do not also display timeout error
    //
    if (!fs.existsSync(kernel)) {
        vscode.window.showErrorMessage("Kernel executable not found: " + kernel);
        return;
    }
    // TODO: kill kernel, if possible
    let report = vscode_1.window.createOutputChannel("Wolfram Language Error Report");
    report.appendLine("Language server kernel did not respond after 15 seconds.");
    report.appendLine("");
    report.appendLine("If the language kernel server did eventually start after this warning, then you can disable this warning with the timeout_warning_enabled setting.");
    report.appendLine("");
    report.appendLine("The most likely cause is that required paclets are not installed.");
    report.appendLine("");
    report.appendLine("The language server kernel process is hanging and may need to be killed manually.");
    report.appendLine("");
    report.appendLine("This is the command that was used:");
    report.appendLine(command.toString());
    report.appendLine("");
    report.appendLine("To ensure that required paclets are installed and up-to-date, run this in a notebook:");
    report.appendLine("");
    report.appendLine("PacletInstall[\"CodeParser\"]");
    report.appendLine("PacletInstall[\"CodeInspector\"]");
    report.appendLine("PacletInstall[\"CodeFormatter\"]");
    report.appendLine("PacletInstall[\"LSPServer\"]");
    report.appendLine("");
    report.appendLine("To help diagnose the problem, run this in a notebook:");
    report.appendLine("");
    report.appendLine("Needs[\"LSPServer`\"]");
    report.append("LSPServer`RunServerDiagnostic[{");
    command.slice(0, -1).forEach((a) => {
        //
        // important to replace \ -> \\ before replacing " -> \"
        //
        report.append("\"" + a.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"");
        report.append(", ");
    });
    report.append("\"" + command[command.length - 1].replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"");
    report.append("}, ProcessDirectory -> \"");
    report.append(wolframTmpDir.replace(/\\/g, "\\\\"));
    report.append("\"]");
    report.appendLine("");
    report.appendLine("");
    report.appendLine("Fix any problems then restart and try again.");
    //
    // FIXME: it would be great to just include the above text in the error message.
    // But VSCode does not currently allow newlines in error messages
    //
    // Related issues: https://github.com/microsoft/vscode/issues/5454
    //
    vscode_1.window.showErrorMessage("Cannot start Wolfram language server. Check Output view and open the Wolfram Language Error Report output channel for more information. ");
}
function implicitTokenCharToText(c) {
    switch (c) {
        case "x": return "\xd7";
        case "z": return " \xd7";
        // add a space before Null because it looks nicer
        case "N": return " Null";
        case "1": return "1";
        case "A": return "All";
        // add spaces before and after \u25a1 because it looks nicer
        case "e": return " \u25a1 ";
        case "f": return "\u25a1\xd7";
        case "y": return "\xd71";
        case "B": return "All\xd7";
        case "C": return "All\xd71";
        case "D": return "All1";
        default: return " ";
    }
}
function onDownloadWolframEngine() {
    const uri = vscode_1.Uri.parse(`https://www.wolfram.com/engine/`);
    vscode_1.commands.executeCommand('vscode.open', uri);
}
//# sourceMappingURL=extension.js.map
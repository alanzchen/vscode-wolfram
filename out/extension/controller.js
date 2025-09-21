"use strict";
/*
 *  vscode-wolfram
 *
 *  Created by IDE support team on 10/01/24.
 *  Copyright (c) 2024 Wolfram Research. All rights reserved.
 *
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WolframNotebookKernel = void 0;
// Copyright 2021 Tianhuan Lu
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
const vscode = require("vscode");
const path = require("path");
const os = require('os');
const fs = require('fs');
const zmq = require("zeromq");
const fs_1 = require("fs");
const child_process = require("child_process");
const ui_items_1 = require("./ui-items");
const notebook_config_1 = require("./notebook-config");
const notebook_kernel_1 = require("./notebook-kernel");
const find_kernel_1 = require("./find-kernel");
class WolframNotebookKernel {
    constructor() {
        this.notebookConfig = vscode.workspace.getConfiguration("wolfram", null);
        this._id = 'wolfram-notebook-kernel';
        this._label = 'Wolfram Kernel';
        this._supportedLanguages = ['wolfram'];
        this.findKernel = new find_kernel_1.FindKernel();
        this.kernelStatusString = "unrevoled";
        this.extensionPath = "";
        this.outputPanel = new ui_items_1.NotebookOutputPanel("Wolfram Language Notebook");
        this.config = new notebook_config_1.NotebookConfig();
        this.executionQueue = new notebook_kernel_1.ExecutionQueue();
        this.selectedNotebooks = new Set();
        this.thisExtension = vscode.extensions.getExtension("WolframResearch.wolfram");
        this.logFile = this.notebookConfig.get("advanced.notebook.logDirectory", "Off");
        if (this.logFile !== "Off") {
            this.logFile = this.logFile + "/" + "Notebook-Log-" + new Date().toUTCString() + ".txt";
            // replace ',', '(', ")" and ':' with '-'
            this.logFile = this.logFile.replace(/\,|\(|\)|:/g, '-');
            this.outputPanel.print(`Log file = ${this.logFile}`);
        }
        ;
        this._controller = vscode.notebooks.createNotebookController(this._id, 'wolfram-notebook', this._label);
        this._controller.supportedLanguages = this._supportedLanguages;
        this._controller.supportsExecutionOrder = true;
        this._controller.executeHandler = this.execute.bind(this);
        this.extensionPath = this.thisExtension?.extensionPath || "";
        // when notebook config changes, send a message to the kernel
        this.config.onDidChange((config) => {
            this.postMessageToKernel({ type: "set-config", config: config.getKernelRelatedConfigs() });
        });
        this._controller.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
            if (selected) {
                this.selectedNotebooks.add(notebook);
                this.outputPanel.print(`The controller is selected for a notebook ${notebook.uri.fsPath}`);
            }
            else {
                this.selectedNotebooks.delete(notebook);
                this.outputPanel.print(`The controller is unselected for a notebook ${notebook.uri.fsPath}`);
            }
            this.outputPanel.print(`There are ${this.selectedNotebooks.size} notebook(s) for which the controller is selected.`);
            if (this.selectedNotebooks.size === 0
            // && this.config.get("kernel.quitAutomatically")
            ) {
                // when the last notebook was closed, and the user choose to quit kernel automatically
                this.quitKernel();
            }
        });
    }
    dispose() {
        this.outputPanel.print(`Killing kernel process, pid = ${this.kernel.pid}`);
        this.quitKernel();
        this._controller.dispose();
    }
    execute(cells, _notebook, _controller) {
        if (this.kernelStatusString === "resolved") {
            for (let cell of cells) {
                this.outputPanel.print("===========Exec start=====================.");
                const execution = this._controller.createNotebookCellExecution(cell);
                console.log(`execute kernelStatusString: , ${this.kernelStatusString}`);
                if (this.kernelStatusString === "resolved") {
                    this.executionQueue.push(execution);
                }
                ;
                execution.token.onCancellationRequested(() => {
                    this.outputPanel.print("Abort evaluation");
                    // process.kill(this.kernel.pid);
                    // this.kernel.kill("SIGKILL");
                    this.kernel.kill(this.kernel.pid, "SIGINT");
                    this.outputPanel.print("Abort evaluation");
                });
            }
            this.outputPanel.print("Execution command sent from NB.");
            this.checkoutExecutionQueue();
        }
    }
    async checkoutExecutionQueue() {
        const currentExecution = this.executionQueue.getNextPendingExecution();
        if (currentExecution) {
            const inputFromCell = currentExecution.execution.cell.document.getText();
            this.outputPanel.print("\n============================================================\n");
            this.outputPanel.print("Input from cell");
            if (this.logFile !== "Off") {
                this.appendFileWrite(this.logFile, this.logString("\n============================================================\n"));
                this.appendFileWrite(this.logFile, this.logString("Input from cell: " + inputFromCell));
            }
            this.outputPanel.print(inputFromCell);
            if (inputFromCell) {
                this.postMessageToKernel({
                    type: "evaluate-cell",
                    uuid: currentExecution.id,
                    text: inputFromCell
                });
                this.executionQueue.start(currentExecution.id);
            }
            else {
                this.executionQueue.start(currentExecution.id);
                this.executionQueue.end(currentExecution.id, false);
            }
        }
    }
    writeFileChecked(path, text) {
        (0, fs_1.writeFile)(path, text, err => {
            if (err) {
                vscode.window.showErrorMessage(`Unable to write file ${path} \n${err.message}`, "Retry", "Save As...", "Dismiss").then(value => {
                    if (value === "Retry") {
                        this.writeFileChecked(path, text);
                    }
                    else if (value === "Save As...") {
                        vscode.window.showSaveDialog({
                            defaultUri: vscode.Uri.file(path),
                            filters: {
                                "All Files": ["*"]
                            }
                        }).then(value => {
                            if (value) {
                                this.writeFileChecked(value.fsPath, text);
                            }
                        });
                    }
                });
                return;
            }
        });
    }
    appendFileWrite(path, text) {
        (0, fs_1.appendFile)(path, text, err => {
            if (err) {
                vscode.window.showErrorMessage(`Unable to write file ${path} \n${err.message}`);
                return;
            }
        });
    }
    async launchKernel() {
        this.outputPanel.print("************  Entering launchKernel  ***************");
        this.outputPanel.print((`TS log file = ${this.logFile}`));
        let kernelInitPath = path.join(this.extensionPath, 'resources', 'init.wl');
        if (process.platform === "win32") {
            kernelInitPath = kernelInitPath.replace(/\\/g, "/");
        }
        ;
        const kernelRenderInitPath = path.join(this.extensionPath, 'resources', 'render-html.wl');
        let kernelRenderInitString = "";
        const kernelPort = this.getRandomPort("49152-65535");
        let launchCommand = "";
        let launchArguments = [""];
        try {
            kernelRenderInitString = (0, fs_1.readFileSync)(kernelRenderInitPath).toString();
        }
        catch (error) {
            vscode.window.showErrorMessage("Failed to read kernel initialization files.");
            return;
        }
        const kernelInitCommands = `ToExpression["VsCodeWolfram\`Private\`zmqPort=${kernelPort}; Get[\\"${kernelInitPath}\\"]"]`;
        if (this.logFile !== "Off") {
            this.appendFileWrite(this.logFile, this.logString(kernelInitCommands));
        }
        launchCommand = this.findKernel.resolveKernel();
        if (process.platform === "win32") {
            launchCommand = launchCommand.replace("WolframKernel.exe", "wolfram.exe");
        }
        ;
        launchArguments = ["-run", kernelInitCommands];
        this.outputPanel.print("Launching kernel");
        this.outputPanel.print(`NotebookKernel = ${launchCommand}`);
        this.kernel = child_process.spawn(launchCommand, launchArguments, { stdio: "pipe" });
        if (this.kernel) {
            this.outputPanel.print(`kernel process pid = ${this.kernel.pid}`);
            if (this.logFile !== "Off") {
                this.appendFileWrite(this.logFile, this.logString(`kernel process pid = ${this.kernel.pid}`));
            }
            ;
        }
        const launchPromise = new Promise((resolve, reject) => {
            const connectionTimeout = setTimeout(() => {
                reject(new Error("Kernel initialization took too long"));
            }, 15000);
            this.kernel.stdout.on("data", async (data) => {
                this.outputPanel.print(`kernel process async pid = ${this.kernel.pid}`);
                const message = data.toString();
                if (message.startsWith("<ERROR> ")) {
                    // a fatal error
                    vscode.window.showErrorMessage("The kernel has stopped due to the following error: " + message.slice(8));
                    return;
                }
                this.outputPanel.print("LaunchKernel: Received the following data from kernel:");
                this.outputPanel.print(`${data.toString()}`);
                // TODO: Config first meassage from kernel (not wolframscript)
                const match = message.match(/\[address tcp:\/\/(127.0.0.1:[0-9]+)\]/);
                if (match) {
                    this.socket = new zmq.Pair({ linger: 0 });
                    this.socket.connect("tcp://" + match[1]);
                    const rand = Math.floor(Math.random() * 1e9).toString();
                    try {
                        this.evaluateFrontEnd(kernelRenderInitString, false);
                        this.postMessageToKernel({ type: "test", text: rand });
                        let timer;
                        const [received] = await Promise.race([
                            this.socket.receive(),
                            new Promise(res => timer = setTimeout(() => res([new Error("timeout")]), 10000 // milliseconds
                            ))
                        ]).finally(() => clearTimeout(timer));
                        if (received instanceof Error) {
                            throw received;
                        }
                        this.outputPanel.print("launchKernel :> Received the following test message from kernel:");
                        this.outputPanel.print(`${received.toString()}`);
                        // this.firstResponse = await this.handleMessageFromKernel();
                        this.handleMessageFromKernel();
                        if (this.logFile !== "Off") {
                            this.appendFileWrite(this.logFile, this.logString("================ Kernel launched with kernel message handler =======================\n\n"));
                        }
                        console.log("================ Kernel launched with kernel message handler =======================");
                        vscode.window.showInformationMessage("Notebook kernel launched, ready for notebook evaluation.");
                        resolve("hello from stdout");
                        clearTimeout(connectionTimeout);
                        this.kernelStatusString = "resolved";
                    }
                    catch (error) {
                        this.outputPanel.print("The kernel took too long to respond through the ZeroMQ link.");
                    }
                }
            });
            this.kernel.stderr.on("data", async (data) => {
                this.outputPanel.print(`stderr output = ${data.toString()}`);
            });
        });
        let returnPromise = await launchPromise;
        return returnPromise;
    }
    // End of launchKernel
    logString(str) {
        return "[" + new Date().toUTCString() + "] " + str + "\n";
    }
    getRandomPort(portRanges) {
        let ranges = [...portRanges.matchAll(/\s*(\d+)\s*(?:[-‐‑‒–]\s*(\d+)\s*)?/g)]
            .map(match => [parseInt(match[1]), parseInt(match[match[2] === undefined ? 1 : 2])])
            .map(pair => [Math.max(Math.min(pair[0], pair[1]), 1), Math.min(Math.max(pair[0], pair[1]) + 1, 65536)])
            .filter(pair => pair[0] < pair[1]);
        if (ranges.length === 0) {
            ranges = [[49152, 65536]];
        }
        let cmf = [];
        ranges.reduce((acc, pair, i) => {
            cmf[i] = acc + (pair[1] - pair[0]);
            return cmf[i];
        }, 0);
        const rand = Math.random() * cmf[cmf.length - 1];
        for (let i = 0; i < cmf.length; ++i) {
            if (rand <= cmf[i]) {
                const [lower, upper] = ranges[i];
                return Math.min(Math.floor(Math.random() * (upper - lower)) + lower, upper - 1);
            }
        }
    }
    postMessageToKernel(message) {
        if (this.socket !== undefined) {
            if (this.logFile !== "Off") {
                this.appendFileWrite(this.logFile, this.logString(("TS -> WL: " + JSON.stringify(message)).substring(0, 400)));
            }
            this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
        }
        else {
            this.outputPanel.print("The socket is not available; cannot post the message.");
        }
    }
    evaluateFrontEnd(text, asynchronous = false) {
        this.postMessageToKernel({
            type: "evaluate-front-end",
            async: asynchronous,
            text: text
        });
    }
    quitKernel() {
        this.outputPanel.print(`Killing kernel process, pid = ${this.kernel.pid}`);
        this.kernel.kill("SIGKILL");
        this.kernel = undefined;
        this.socket.close();
        this.socket = undefined;
    }
    ;
    async handleMessageFromKernel() {
        while (true) {
            let [message] = await this.socket.receive().catch(() => {
                return [new Error("receive-message")];
            });
            if (message instanceof Error) {
                return;
            }
            message = Buffer.from(message).toString("utf-8");
            this.outputPanel.print("handleMessageFromKernel Message Print :> ");
            this.outputPanel.print(JSON.stringify(message));
            if (this.logFile !== "Off") {
                this.appendFileWrite(this.logFile, this.logString("WL -> TS :> " + JSON.stringify(message)));
            }
            try {
                message = JSON.parse(message);
            }
            catch (error) {
                this.outputPanel.print("Failed to parse the following message:");
                this.outputPanel.print(message);
                continue;
            }
            const messageId = message?.uuid || "";
            this.outputPanel.print(`messageId = ${messageId}`);
            const currentExecution = this.executionQueue.find(messageId);
            switch (message.type) {
                case "show-input-name":
                    this.outputPanel.print("show-input-name:");
                    if (currentExecution) {
                        const match = message.name.match(/In\[(\d+)\]/);
                        if (match) {
                            currentExecution.execution.executionOrder = parseInt(match[1]);
                        }
                    }
                    break;
                case "show-output":
                case "show-message":
                case "show-text":
                    this.outputPanel.print("show-output:");
                    if (currentExecution) {
                        const outputItems = [];
                        if (message.text !== "None") {
                            this.outputPanel.print(`text message = ${message.text}`);
                            outputItems.push(vscode.NotebookCellOutputItem.text(message.text, "text/html"));
                        }
                        else {
                            outputItems.push(vscode.NotebookCellOutputItem.text(message.html, "x-application/wolfram-language-html"));
                        }
                        ;
                        const output = new vscode.NotebookCellOutput(outputItems);
                        this.outputPanel.print(`Output = ${output.items.toString}`);
                        if (currentExecution?.hasOutput) {
                            this.outputPanel.print("Output replace:");
                            currentExecution.execution.appendOutput(output);
                        }
                        else {
                            currentExecution.execution.replaceOutput(output);
                            currentExecution.hasOutput = true;
                        }
                    }
                    break;
                case "evaluation-done":
                    this.outputPanel.print("evaluation-done:");
                    this.executionQueue.end(messageId, true);
                    this.checkoutExecutionQueue();
                    break;
                default:
                    this.outputPanel.print("The following message has an unexpect type:");
                    this.outputPanel.print(JSON.stringify(message));
            }
        }
    }
}
exports.WolframNotebookKernel = WolframNotebookKernel;
//# sourceMappingURL=controller.js.map
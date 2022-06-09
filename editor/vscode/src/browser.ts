// Copyright © SixtyFPS GmbH <info@slint-ui.com>
// SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-Slint-commercial


import { ExtensionContext, Uri } from 'vscode';
import * as vscode from 'vscode';
import { LanguageClientOptions } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/browser';

let client: LanguageClient;
let statusBar: vscode.StatusBarItem;

function startClient(context: vscode.ExtensionContext) {

    //let args = vscode.workspace.getConfiguration('slint').get<[string]>('lsp-args');

    const documentSelector = [{ language: 'slint' }];

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector,
        synchronize: {},
        initializationOptions: {}
    };

    const serverMain = Uri.joinPath(context.extensionUri, 'out/browserServerMain.js');
    const worker = new Worker(serverMain.toString(true));
    worker.onmessage = m => {
        // We cannot start sending messages to the client before we start listening which
        // the server only does in a future after the wasm is loaded.
        if (m.data === "OK") {

            client = new LanguageClient('slint-lsp', 'Slint LSP', clientOptions, worker);
            const disposable = client.start();
            context.subscriptions.push(disposable);

            client.onReady().then(() => {
                client.onRequest("slint/load_file", async (param: string) => {
                    return await vscode.workspace.fs.readFile(Uri.parse(param));
                });
                //client.onNotification(serverStatus, (params) => setServerStatus(params, statusBar));
            });
        }
    };
}

let previewPanel: vscode.WebviewPanel | undefined = undefined;
let previewUrl: string = "";


// this method is called when vs code is activated
export function activate(context: vscode.ExtensionContext) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(statusBar);
    statusBar.text = "Slint";

    startClient(context);

    context.subscriptions.push(vscode.commands.registerCommand('slint.showPreview', function () {
        let ae = vscode.window.activeTextEditor;
        if (!ae) {
            return;
        }

        if (previewPanel) {
            previewPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            // Create and show a new webview
            previewPanel = vscode.window.createWebviewPanel(
                'slint-preview',
                'Slint Preview',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
            previewPanel.webview.onDidReceiveMessage(
                async message => {
                    console.log("MESSAGE ", message);
                    switch (message.command) {
                        case 'load_file':
                            const actual_url = Uri.parse(message.url);
                            console.log("actual = ", actual_url);
                            const content = await vscode.workspace.fs.readFile(actual_url);
                            console.log("content = ", content);
                            return content;
                    }
                },
                undefined,
                context.subscriptions
            );
            previewPanel.webview.html = getPreviewHtml();
            previewPanel.onDidDispose(
                () => { previewPanel = undefined; },
                undefined,
                context.subscriptions);
        }

        previewUrl = ae.document.uri.toString();
        previewPanel.webview.postMessage({ command: "preview", base_url: ae.document.uri.toString(), content: ae.document.getText() });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('slint.reload', async function () {
        statusBar.hide();
        await client.stop();
        startClient(context);
    }));

    vscode.workspace.onDidChangeTextDocument(event => {
        if (previewPanel && event.document.uri.toString() === previewUrl) {
            previewPanel.webview.postMessage({
                command: "preview",
                base_url: event.document.uri.toString(),
                content: event.document.getText()

            });
        }
    });
}

function getPreviewHtml(): string {
    // FIXME this should be bundled in the extension, or we need to change this before the release to the release variant
    let slint_wasm_interpreter_url = "https://slint-ui.com/snapshots/master/wasm-interpreter/slint_wasm_interpreter.js";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Slint Preview</title>
    <script type="module">
    "use strict";
    import * as slint from '${slint_wasm_interpreter_url}';
    await slint.default();

    const vscode = acquireVsCodeApi();

    async function load_file(url) {
        console.log("LOAD ", url);
        let xxx = await vscode.postMessage({
                        command: 'load_file',
                        url: url,
        });
        console.log(xxx);

        return "/* nothing */";
    }

    async function render(source, base_url) {
        let { component, error_string } = await slint.compile_from_string(source, base_url, async(url) => await load_file(url));
        if (error_string != "") {
            var text = document.createTextNode(error_string);
            var p = document.createElement('pre');
            p.appendChild(text);
            document.getElementById("slint_error_div").innerHTML = "<pre style='color: red; background-color:#fee; margin:0'>" + p.innerHTML + "</pre>";
        }
        if (component !== undefined) {
            document.getElementById("slint_error_div").innerHTML = "";
            let instance = component.run("slint_canvas");
        }
    }

    window.addEventListener('message', async event => {
        if (event.data.command === "preview") {
            await render(event.data.content, event.data.base_url);
        }
    })
    </script>
</head>
<body>
  <div id="slint_error_div"></div>
  <canvas id="slint_canvas"></canvas>
</body>
</html>`;
}
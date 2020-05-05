import * as vscode from "vscode";
import * as path from 'path';
import * as fs from 'fs';
import * as axios from 'axios';
import * as realine from 'readline';

interface NoteTaskDefinition extends vscode.TaskDefinition {
    inputFile: string,
    outputFile: string
}

class NoteTaskTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite = this.writeEmitter.event;

    private closeEmitter = new vscode.EventEmitter<void>();
    onDidClose? = this.closeEmitter.event;

    private httpClient = axios.default;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    constructor(
        private filename: string,
        private workspaceRoot: string,
    ) {}

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.doBuild().then((value)=> {
            this.writeEmitter.fire('build complete');
        }).catch((error)=> {
            this.writeEmitter.fire('build failed');
            this.writeEmitter.fire(error);
        });
    }

    close() {}

    private async buildNote(line: string): Promise<{keyword: string, sentence: string}[]|undefined> {
        const regExp = /(<.*?>)/g;
        let keywords = line.match(regExp);
        if (!keywords) {
           return undefined; 
        }
     
        let result: {keyword: string, sentence: string}[] = [];
        
        for (let i = 0; i < keywords!.length; i++) {
            let value = keywords![i];
            this.writeEmitter.fire(`\tfind keyword: ${value}\r\n`);
            let definition = await this.searchDict(value);
            if (!definition) {
                definition = "";
            }
            console.log(definition);
            result.push({keyword: value.replace(/[<>]*/g, ''), sentence: definition});
        }
        keywords?.forEach(async (value: string) => {
            this.writeEmitter.fire(`\tfind keyword: ${value}\r\n`);
            let definition = await this.searchDict(value);
            if (!definition) {
                definition = "";
            }
            console.log(definition);
            result.push({keyword: value.replace(/[<>]*/g, ''), sentence: definition});
        });
        return result;
    }

    private async searchDict(word: string): Promise<string|undefined> {
        // return "test search result";
        try {
            const response: axios.AxiosResponse = await this.httpClient.get(`http://127.0.0.1:8080/?word=${word.replace(/[<>]/g, '')}`);
            console.log(response);
            return <string>response.data;
        } catch(error) {
            console.log(error);
        }

        return undefined;
    }

    private async doBuild(): Promise<void> {
        return new Promise<void>(
            (resolve) => {
                this.writeEmitter.fire('Starting build...\r\n');
                this.writeEmitter.fire(`process file: ${this.filename}\r\n`);
                const stream = fs.createReadStream(this.filename);
                const reader = realine.createInterface(
                    {
                        input: stream,
                        crlfDelay: Infinity,
                    }
                );
                reader.on('line', async (line) => {
                    this.writeEmitter.fire(`processing line: ${line}\r\n`);
                    let m = await this.buildNote(line);     
                    if (!m) {
                        return;
                    }           
                    m?.forEach((value) => {
                        fs.writeFileSync(path.join(this.workspaceRoot, 'output.txt'), 
                        `${value.keyword}\t${line.replace(/[<>]*/g, '')}\t${value.sentence}\r\n`,
                        {encoding: 'utf8', flag: 'a+'});
                    });
                });
                this.writeEmitter.fire('Build complete.\r\n');
                this.closeEmitter.fire();
                resolve();
            }
        );
    }
}

export class NoteTaskProvider implements vscode.TaskProvider {
    static NoteType: string = 'note';
    private notePromise: Thenable<vscode.Task[]> | undefined = undefined;
    private filename: string | undefined = vscode.window.activeTextEditor?.document.uri.fsPath;
    private tasks: vscode.Task[] | undefined;

    constructor(
        private workspaceRoot: string,
    ) {}

    public async provideTasks(): Promise<vscode.Task[]> {
       return this.getTasks(
            {
                type: NoteTaskProvider.NoteType,
                inputFile: this.filename!,
                outputFile: path.join(this.workspaceRoot, 'output.txt')
            }
        );
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        const task = _task.definition.task;
        if (task) {
           const definition: NoteTaskDefinition = <NoteTaskDefinition>_task.definition;
           return this.getTasks(definition)[0];
        }
        return undefined;
    }

    private getTasks(definition?: NoteTaskDefinition): vscode.Task[]  {
        if (definition === undefined) {
            definition = {
                inputFile: this.filename!,
                outputFile: path.join(this.workspaceRoot, 'output.txt'),
                type: NoteTaskProvider.NoteType,
            };
        }
        this.tasks = [];
        this.tasks!.push(
            new vscode.Task(
                definition,
                vscode.TaskScope.Workspace,
                definition.inputFile,
                definition.type,
                new vscode.CustomExecution(
                    async (): Promise<vscode.Pseudoterminal> => {
                        return new NoteTaskTerminal(
                            definition?.inputFile!,
                            this.workspaceRoot,
                        );
                    }
                )
            )
        );
        return this.tasks;
    }
}

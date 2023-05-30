// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.
import { parentPort, workerData } from 'node:worker_threads';

import type * as TTypescript from 'typescript';
import type {
  ITranspilationErrorMessage,
  ITranspilationRequestMessage,
  ITranspilationSuccessMessage,
  ITypescriptWorkerData
} from './types';
import type { ExtendedTypeScript } from './internalTypings/TypeScriptInternals';
import { configureProgramForMultiEmit } from './configureProgramForMultiEmit';

const typedWorkerData: ITypescriptWorkerData = workerData;

const ts: ExtendedTypeScript = require(typedWorkerData.typeScriptToolPath);

function handleMessage(message: ITranspilationRequestMessage | false): void {
  if (!message) {
    process.exit(0);
  }

  try {
    const response: ITranspilationSuccessMessage = runTranspiler(message);
    parentPort!.postMessage(response);
  } catch (err) {
    const errorResponse: ITranspilationErrorMessage = {
      requestId: message.requestId,
      type: 'error',
      result: {
        message: err.message,
        ...Object.fromEntries(Object.entries(err))
      }
    };
    parentPort!.postMessage(errorResponse);
  }
}

function runTranspiler(message: ITranspilationRequestMessage): ITranspilationSuccessMessage {
  const { requestId, compilerOptions, moduleKindsToEmit, filesToTranspile } = message;

  const fullySkipTypeCheck: boolean =
    /* TypeScript 5+ */ compilerOptions.verbatimModuleSyntax ||
    /* TypeScript 4 */ compilerOptions.importsNotUsedAsValues === ts.ImportsNotUsedAsValues.Error;

  for (const [option, value] of Object.entries(ts.getDefaultCompilerOptions())) {
    if (compilerOptions[option] === undefined) {
      compilerOptions[option] = value;
    }
  }

  const { target: rawTarget } = compilerOptions;

  for (const option of ts.transpileOptionValueCompilerOptions) {
    compilerOptions[option.name] = option.transpileOptionValue;
  }

  compilerOptions.suppressOutputPathCheck = true;
  compilerOptions.skipDefaultLibCheck = true;
  compilerOptions.preserveValueImports = true;

  const sourceFileByPath: Map<string, TTypescript.SourceFile> = new Map();

  const includedFiles: string[] = [];
  for (const [fileName, sourceText] of filesToTranspile) {
    if (sourceText) {
      const sourceFile: TTypescript.SourceFile = ts.createSourceFile(fileName, sourceText, rawTarget!);
      sourceFile.hasNoDefaultLib = fullySkipTypeCheck;
      sourceFileByPath.set(fileName, sourceFile);
      includedFiles.push(fileName);
    }
  }

  const newLine: string = ts.getNewLineCharacter(compilerOptions);

  const compilerHost: TTypescript.CompilerHost = {
    getSourceFile: (fileName: string) => sourceFileByPath.get(fileName),
    writeFile: ts.sys.writeFile,
    getDefaultLibFileName: () => 'lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (fileName: string) => fileName,
    getCurrentDirectory: () => '',
    getNewLine: () => newLine,
    fileExists: (fileName: string) => sourceFileByPath.has(fileName),
    readFile: () => '',
    directoryExists: () => true,
    getDirectories: () => []
  };

  const program: TTypescript.Program = ts.createProgram(includedFiles, compilerOptions, compilerHost);

  configureProgramForMultiEmit(program, ts, moduleKindsToEmit, 'transpile');

  const result: TTypescript.EmitResult = program.emit(undefined, undefined, undefined, undefined, undefined);

  const response: ITranspilationSuccessMessage = {
    requestId,
    type: 'success',
    result
  };

  return response;
}

parentPort!.on('message', handleMessage);

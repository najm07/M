/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { AIModelConfiguration } from '../common/aiTypes.js';

/**
 * Test utilities for AI service tests
 */
export class AITestUtils {
	/**
	 * Creates a mock model configuration
	 */
	static createMockModel(id: string, overrides?: Partial<AIModelConfiguration>): AIModelConfiguration {
		return {
			id,
			api: URI.parse('https://api.test.com/v1'),
			apiKey: 'test-key',
			family: 'test',
			isDefault: false,
			...overrides,
		};
	}

	/**
	 * Creates a mock config file content
	 */
	static createMockConfig(models: Record<string, any>): string {
		return JSON.stringify({ models }, null, 2);
	}

	/**
	 * Creates a test workspace URI
	 */
	static createTestWorkspace(): URI {
		return URI.file('/test/workspace');
	}

	/**
	 * Creates a test file URI
	 */
	static createTestFile(path: string): URI {
		return URI.file(`/test/workspace/${path}`);
	}

	/**
	 * Creates mock file content
	 */
	static createMockFileContent(imports: string[] = [], exports: string[] = []): string {
		const importStatements = imports.map(imp => `import { something } from '${imp}';`).join('\n');
		const exportStatements = exports.map(exp => `export function ${exp}() {}`).join('\n');
		return `${importStatements}\n\n${exportStatements}\n`;
	}

	/**
	 * Waits for async operations to complete
	 */
	static async wait(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import { IRange } from '../../../editor/common/core/range.js';

export const IProjectGraphService = createDecorator<IProjectGraphService>('projectGraphService');

export interface ProjectNode {
	readonly uri: URI;
	readonly name: string;
	readonly type: 'file' | 'function' | 'class' | 'interface' | 'variable' | 'type';
	readonly range?: IRange;
	readonly exports?: string[];
	readonly imports?: ImportReference[];
	readonly calls?: CallReference[];
	readonly calledBy?: CallReference[];
	readonly metadata?: Record<string, unknown>;
}

export interface ImportReference {
	readonly from: URI;
	readonly symbols?: string[];
	readonly isTypeOnly?: boolean;
}

export interface CallReference {
	readonly target: URI;
	readonly symbol?: string;
	readonly range?: IRange;
}

export interface ProjectGraph {
	readonly nodes: Map<string, ProjectNode>;
	readonly edges: Array<{ from: string; to: string; type: 'import' | 'call' | 'export' }>;
	readonly lastUpdated: number;
}

export interface IProjectGraphService {
	readonly _serviceBrand: undefined;

	readonly onDidUpdateGraph: Event<URI>;

	/**
	 * Get the project graph for a workspace.
	 */
	getGraph(workspaceRoot: URI): Promise<ProjectGraph>;

	/**
	 * Get nodes related to a given file or symbol.
	 */
	getRelatedNodes(uri: URI, symbol?: string, maxDepth?: number): Promise<ProjectNode[]>;

	/**
	 * Get files that import or call a given symbol.
	 */
	getDependents(uri: URI, symbol?: string): Promise<ProjectNode[]>;

	/**
	 * Get files that a given file depends on.
	 */
	getDependencies(uri: URI): Promise<ProjectNode[]>;

	/**
	 * Rebuild the project graph for a workspace.
	 */
	rebuildGraph(workspaceRoot: URI, token?: CancellationToken): Promise<void>;

	/**
	 * Get call chain for a function (what it calls and what calls it).
	 */
	getCallChain(uri: URI, symbol: string): Promise<{ calls: ProjectNode[]; calledBy: ProjectNode[] }>;
}


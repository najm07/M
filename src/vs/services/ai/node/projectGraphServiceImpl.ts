/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { joinPath } from '../../../base/common/resources.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.js';
import { IProjectGraphService, ProjectGraph, ProjectNode, ImportReference } from '../common/projectGraphService.js';
import { IModelService } from '../../../editor/common/services/model.js';
import { VSBuffer } from '../../../base/common/buffer.js';
const PROJECT_GRAPH_VERSION = 1;

interface GraphData {
	version: number;
	workspaceRoot: string;
	nodes: Record<string, any>;
	edges: Array<{ from: string; to: string; type: 'import' | 'call' | 'export' }>;
	lastUpdated: number;
}

export class ProjectGraphService extends Disposable implements IProjectGraphService {
	declare _serviceBrand: undefined;

	private readonly _graphs = new Map<string, ProjectGraph>();
	private readonly _graphPath: URI;

	private readonly _onDidUpdateGraph = new Emitter<URI>();
	public readonly onDidUpdateGraph: Event<URI> = this._onDidUpdateGraph.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IModelService private readonly modelService: IModelService,
	) {
		super();

		this._graphPath = joinPath(this.environmentService.userRoamingDataHome, '.vscode', 'context', 'graph.json');
	}

	override dispose(): void {
		this._onDidUpdateGraph.dispose();
		super.dispose();
	}

	async getGraph(workspaceRoot: URI): Promise<ProjectGraph> {
		const key = workspaceRoot.toString();
		let graph = this._graphs.get(key);

		if (!graph) {
			// Try loading from storage
			await this.loadGraph(workspaceRoot);
			graph = this._graphs.get(key);
		}

		if (!graph) {
			// Create empty graph
			graph = {
				nodes: new Map(),
				edges: [],
				lastUpdated: Date.now(),
			};
			this._graphs.set(key, graph);
		}

		return graph;
	}

	async getRelatedNodes(uri: URI, symbol?: string, maxDepth: number = 2): Promise<ProjectNode[]> {
		const workspaceRoot = this.getWorkspaceRoot(uri);
		if (!workspaceRoot) {
			return [];
		}

		const graph = await this.getGraph(workspaceRoot);
		const uriStr = uri.toString();
		const related = new Set<string>();
		const result: ProjectNode[] = [];

		// Add the node itself
		const node = graph.nodes.get(uriStr);
		if (node) {
			related.add(uriStr);
			result.push(node);
		}

		// BFS to find related nodes
		const queue: Array<{ uri: string; depth: number }> = [{ uri: uriStr, depth: 0 }];
		const visited = new Set<string>();

		while (queue.length > 0) {
			const { uri: currentUri, depth } = queue.shift()!;
			if (visited.has(currentUri) || depth > maxDepth) {
				continue;
			}
			visited.add(currentUri);

			const currentNode = graph.nodes.get(currentUri);
			if (!currentNode) {
				continue;
			}

			// Add imports and dependencies
			if (currentNode.imports) {
				for (const imp of currentNode.imports) {
					const importUri = imp.from.toString();
					if (!visited.has(importUri) && graph.nodes.has(importUri)) {
						queue.push({ uri: importUri, depth: depth + 1 });
						if (!related.has(importUri)) {
							related.add(importUri);
							const importNode = graph.nodes.get(importUri);
							if (importNode) {
								result.push(importNode);
							}
						}
					}
				}
			}

			// Add call references
			if (currentNode.calls) {
				for (const call of currentNode.calls) {
					const callUri = call.target.toString();
					if (!visited.has(callUri) && graph.nodes.has(callUri)) {
						queue.push({ uri: callUri, depth: depth + 1 });
						if (!related.has(callUri)) {
							related.add(callUri);
							const callNode = graph.nodes.get(callUri);
							if (callNode) {
								result.push(callNode);
							}
						}
					}
				}
			}
		}

		return result;
	}

	async getDependents(uri: URI, symbol?: string): Promise<ProjectNode[]> {
		const workspaceRoot = this.getWorkspaceRoot(uri);
		if (!workspaceRoot) {
			return [];
		}

		const graph = await this.getGraph(workspaceRoot);
		const uriStr = uri.toString();
		const dependents: ProjectNode[] = [];

		for (const node of graph.nodes.values()) {
			// Check if this node imports the target
			if (node.imports?.some(imp => imp.from.toString() === uriStr)) {
				dependents.push(node);
			}

			// Check if this node calls the target
			if (node.calls?.some(call => call.target.toString() === uriStr)) {
				dependents.push(node);
			}
		}

		return dependents;
	}

	async getDependencies(uri: URI): Promise<ProjectNode[]> {
		const workspaceRoot = this.getWorkspaceRoot(uri);
		if (!workspaceRoot) {
			return [];
		}

		const graph = await this.getGraph(workspaceRoot);
		const uriStr = uri.toString();
		const node = graph.nodes.get(uriStr);
		if (!node) {
			return [];
		}

		const dependencies: ProjectNode[] = [];

		if (node.imports) {
			for (const imp of node.imports) {
				const importNode = graph.nodes.get(imp.from.toString());
				if (importNode) {
					dependencies.push(importNode);
				}
			}
		}

		return dependencies;
	}

	async rebuildGraph(workspaceRoot: URI, token?: CancellationToken): Promise<void> {
		this.logService.info('[ProjectGraphService] Rebuilding graph for workspace', workspaceRoot.toString());

		const nodes = new Map<string, ProjectNode>();
		const edges: Array<{ from: string; to: string; type: 'import' | 'call' | 'export' }> = [];

		try {
			// Find all code files
			const files = await this.fileService.resolve(workspaceRoot);
			if (files.children) {
				await this.processDirectory(files.children, workspaceRoot, nodes, edges, token);
			}
		} catch (error) {
			this.logService.error('[ProjectGraphService] Error rebuilding graph', error);
		}

		const graph: ProjectGraph = {
			nodes,
			edges,
			lastUpdated: Date.now(),
		};

		this._graphs.set(workspaceRoot.toString(), graph);
		await this.saveGraph(workspaceRoot, graph);
		this._onDidUpdateGraph.fire(workspaceRoot);
	}

	async getCallChain(uri: URI, symbol: string): Promise<{ calls: ProjectNode[]; calledBy: ProjectNode[] }> {
		const workspaceRoot = this.getWorkspaceRoot(uri);
		if (!workspaceRoot) {
			return { calls: [], calledBy: [] };
		}

		const graph = await this.getGraph(workspaceRoot);
		const calls: ProjectNode[] = [];
		const calledBy: ProjectNode[] = [];

		const node = graph.nodes.get(uri.toString());
		if (node && node.calls) {
			for (const call of node.calls) {
				const callNode = graph.nodes.get(call.target.toString());
				if (callNode) {
					calls.push(callNode);
				}
			}
		}

		for (const otherNode of graph.nodes.values()) {
			if (otherNode.calls?.some(call => call.target.toString() === uri.toString() && call.symbol === symbol)) {
				calledBy.push(otherNode);
			}
		}

		return { calls, calledBy };
	}

	private async processDirectory(
		children: Array<{ resource: URI; isDirectory: boolean }>,
		workspaceRoot: URI,
		nodes: Map<string, ProjectNode>,
		edges: Array<{ from: string; to: string; type: 'import' | 'call' | 'export' }>,
		token?: CancellationToken,
	): Promise<void> {
		for (const child of children) {
			if (token?.isCancellationRequested) {
				break;
			}

			if (child.isDirectory) {
				try {
					const dir = await this.fileService.resolve(child.resource);
					if (dir.children) {
						await this.processDirectory(dir.children, workspaceRoot, nodes, edges, token);
					}
				} catch (error) {
					// Skip directories we can't read
				}
			} else if (this.shouldProcessFile(child.resource)) {
				try {
					const node = await this.processFile(child.resource, workspaceRoot);
					if (node) {
						nodes.set(node.uri.toString(), node);

						// Add edges for imports
						if (node.imports) {
							for (const imp of node.imports) {
								edges.push({
									from: node.uri.toString(),
									to: imp.from.toString(),
									type: 'import',
								});
							}
						}

						// Add edges for calls
						if (node.calls) {
							for (const call of node.calls) {
								edges.push({
									from: node.uri.toString(),
									to: call.target.toString(),
									type: 'call',
								});
							}
						}
					}
				} catch (error) {
					this.logService.debug(`[ProjectGraphService] Failed to process ${child.resource.toString()}`, error);
				}
			}
		}
	}

	private async processFile(uri: URI, workspaceRoot: URI): Promise<ProjectNode | undefined> {
		const model = this.modelService.getModel(uri);
		if (!model) {
			// Try to read file
			try {
				const content = await this.fileService.readFile(uri);
				// For now, we'll use a simple parser
				// In production, this should use language services
				return this.parseFileSimple(uri, content.value.toString(), workspaceRoot);
			} catch (error) {
				return undefined;
			}
		}

		return this.parseFileWithLanguageService(uri, model.getValue(), workspaceRoot);
	}

	private parseFileSimple(uri: URI, content: string, workspaceRoot: URI): ProjectNode {
		const imports: ImportReference[] = [];
		const exports: string[] = [];

		// Simple regex-based parsing (can be enhanced with language services)
		const importRegex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g;
		const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g;

		let match;
		while ((match = importRegex.exec(content)) !== null) {
			const importPath = match[1];
			const resolvedUri = this.resolveImport(uri, importPath, workspaceRoot);
			if (resolvedUri) {
				imports.push({ from: resolvedUri });
			}
		}

		while ((match = exportRegex.exec(content)) !== null) {
			exports.push(match[1]);
		}

		return {
			uri,
			name: uri.path.split('/').pop() || uri.toString(),
			type: 'file',
			imports,
			exports,
		};
	}

	private parseFileWithLanguageService(uri: URI, content: string, workspaceRoot: URI): ProjectNode {
		// Use language service if available
		// For now, fall back to simple parsing
		return this.parseFileSimple(uri, content, workspaceRoot);
	}

	private resolveImport(from: URI, importPath: string, workspaceRoot: URI): URI | undefined {
		// Simple resolution - can be enhanced
		if (importPath.startsWith('.')) {
			const baseDir = joinPath(from, '..');
			return joinPath(baseDir, importPath.replace(/\.(ts|js|tsx|jsx)$/, ''));
		}

		// Handle node_modules imports
		// This is simplified - real implementation would need module resolution
		return undefined;
	}

	private shouldProcessFile(uri: URI): boolean {
		const path = uri.path.toLowerCase();
		const excludePatterns = [
			'node_modules',
			'.git',
			'out',
			'dist',
			'build',
			'.vscode',
		];

		if (excludePatterns.some(pattern => path.includes(pattern))) {
			return false;
		}

		const codeExtensions = ['.ts', '.tsx', '.js', '.jsx'];
		return codeExtensions.some(ext => path.endsWith(ext));
	}

	private getWorkspaceRoot(uri: URI): URI | undefined {
		// Simplified - should use workspace service
		// Find workspace root by looking for common markers
		// This is a placeholder
		return uri;
	}

	private async loadGraph(workspaceRoot: URI): Promise<void> {
		const key = workspaceRoot.toString();
		try {
			if (await this.fileService.exists(this._graphPath)) {
				const content = await this.fileService.readFile(this._graphPath);
				const data: GraphData = JSON.parse(content.value.toString());

				if (data.version === PROJECT_GRAPH_VERSION && data.workspaceRoot === key) {
					const nodes = new Map<string, ProjectNode>();
					for (const [uriStr, nodeData] of Object.entries(data.nodes)) {
						nodes.set(uriStr, {
							...nodeData,
							uri: URI.parse(uriStr),
							imports: nodeData.imports?.map((imp: any) => ({
								...imp,
								from: URI.parse(imp.from),
							})),
							calls: nodeData.calls?.map((call: any) => ({
								...call,
								target: URI.parse(call.target),
							})),
						});
					}

					this._graphs.set(key, {
						nodes,
						edges: data.edges as Array<{ from: string; to: string; type: 'import' | 'call' | 'export' }>,
						lastUpdated: data.lastUpdated,
					});
					this.logService.info(`[ProjectGraphService] Loaded graph with ${nodes.size} nodes`);
				}
			}
		} catch (error) {
			this.logService.warn('[ProjectGraphService] Failed to load graph', error);
		}
	}

	private async saveGraph(workspaceRoot: URI, graph: ProjectGraph): Promise<void> {
		const data: GraphData = {
			version: PROJECT_GRAPH_VERSION,
			workspaceRoot: workspaceRoot.toString(),
			nodes: Object.fromEntries(
				Array.from(graph.nodes.entries()).map(([uriStr, node]) => [
					uriStr,
					{
						...node,
						uri: node.uri.toJSON(),
						imports: node.imports?.map(imp => ({
							...imp,
							from: imp.from.toJSON(),
						})),
						calls: node.calls?.map(call => ({
							...call,
							target: call.target.toJSON(),
						})),
					},
				])
			),
			edges: graph.edges,
			lastUpdated: graph.lastUpdated,
		};

		try {
			const dir = joinPath(this._graphPath, '..');
			if (!(await this.fileService.exists(dir))) {
				await this.fileService.createFolder(dir);
			}

			await this.fileService.writeFile(this._graphPath, VSBuffer.fromString(JSON.stringify(data, null, 2)));
		} catch (error) {
			this.logService.warn('[ProjectGraphService] Failed to save graph to file', error);
		}
	}
}


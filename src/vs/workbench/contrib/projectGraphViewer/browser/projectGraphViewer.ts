/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProjectGraphService, ProjectGraph } from '../../../../services/ai/common/projectGraphService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { WebviewInput } from '../../../contrib/webviewPanel/browser/webviewEditorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorActivation } from '../../../../platform/editor/common/editor.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

export class ProjectGraphViewer extends Disposable {
	private static readonly VIEW_TYPE = 'projectGraph.viewer';

	constructor(
		private readonly webviewOverlayService: IWebviewService,
		private readonly projectGraphService: IProjectGraphService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly logService: ILogService,
		private readonly editorService: IEditorService,
		private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	async showGraph(): Promise<void> {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			this.logService.warn('[ProjectGraphViewer] No workspace folder found');
			return;
		}

		const workspaceRoot = workspaceFolders[0].uri;
		const graph = await this.projectGraphService.getGraph(workspaceRoot);

		// Create or get existing webview
		const webviewInput = this.createOrGetWebview();
		webviewInput.webview.setHtml(this.getHtml(graph));

		// Open the webview
		await this.editorService.openEditor(webviewInput, {
			pinned: true,
			activation: EditorActivation.PRESERVE,
		});
	}

	private createOrGetWebview(): WebviewInput {
		// Check if webview already exists by trying to find it in open editors
		for (const editor of this.editorService.editors) {
			if (editor instanceof WebviewInput && editor.viewType === ProjectGraphViewer.VIEW_TYPE) {
				return editor;
			}
		}

		const webview = this.webviewOverlayService.createWebviewOverlay({
			origin: 'vscode-project-graph-viewer',
			providedViewType: ProjectGraphViewer.VIEW_TYPE,
			title: 'Project Graph',
			options: {
				retainContextWhenHidden: true,
			},
			contentOptions: {
				enableCommandUris: true,
				allowScripts: true,
			},
			extension: undefined,
		});

		const webviewInput = this._register(this.instantiationService.createInstance(WebviewInput, {
			viewType: ProjectGraphViewer.VIEW_TYPE,
			providedId: ProjectGraphViewer.VIEW_TYPE,
			name: 'Project Graph',
			iconPath: undefined,
		}, webview));

		// Handle messages from webview
		this._register(webview.onMessage(async (message: any) => {
			switch (message.command) {
				case 'refresh':
					const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
					if (workspaceFolders.length > 0) {
						const workspaceRoot = workspaceFolders[0].uri;
						await this.projectGraphService.rebuildGraph(workspaceRoot);
						const graph = await this.projectGraphService.getGraph(workspaceRoot);
						webview.setHtml(this.getHtml(graph));
					}
					break;
				case 'openFile':
					if (message.uri) {
						const uri = URI.parse(message.uri);
						await this.editorService.openEditor({ resource: uri });
					}
					break;
			}
		}));

		return webviewInput;
	}

	private getHtml(graph: ProjectGraph): string {
		const nodes = Array.from(graph.nodes.values());
		const edges = graph.edges;

		// Convert graph to JSON for visualization
		const graphData = {
			nodes: nodes.map(node => ({
				id: node.uri.toString(),
				label: node.name,
				type: node.type,
				uri: node.uri.toString(),
			})),
			edges: edges.map(edge => ({
				source: edge.from,
				target: edge.to,
				type: edge.type,
			})),
		};

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Project Graph</title>
	<style>
		body {
			margin: 0;
			padding: 20px;
			font-family: var(--vscode-font-family);
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		.toolbar {
			margin-bottom: 20px;
			display: flex;
			gap: 10px;
		}
		button {
			padding: 8px 16px;
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 2px;
			cursor: pointer;
		}
		button:hover {
			background-color: var(--vscode-button-hoverBackground);
		}
		#graph-container {
			width: 100%;
			height: calc(100vh - 100px);
			border: 1px solid var(--vscode-panel-border);
			background-color: var(--vscode-editor-background);
		}
		.node {
			cursor: pointer;
		}
		.node:hover {
			opacity: 0.8;
		}
		.edge {
			stroke: var(--vscode-textLink-foreground);
			stroke-width: 2;
		}
		.edge.import {
			stroke: var(--vscode-textLink-foreground);
		}
		.edge.call {
			stroke: var(--vscode-errorForeground);
		}
		.label {
			font-size: 12px;
			fill: var(--vscode-editor-foreground);
			pointer-events: none;
		}
		.info {
			margin-top: 10px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<button onclick="refreshGraph()">Refresh Graph</button>
		<button onclick="resetZoom()">Reset Zoom</button>
	</div>
	<div id="graph-container"></div>
	<div class="info">
		Nodes: ${nodes.length} | Edges: ${edges.length} | Last Updated: ${new Date(graph.lastUpdated).toLocaleString()}
	</div>
	<script src="https://d3js.org/d3.v7.min.js"></script>
	<script>
		const vscode = acquireVsCodeApi();
		const graphData = ${JSON.stringify(graphData)};
		let svg, simulation, zoom;

		function initGraph() {
			const container = d3.select('#graph-container');
			container.selectAll('*').remove();

			const width = container.node().clientWidth;
			const height = container.node().clientHeight;

			svg = container.append('svg')
				.attr('width', width)
				.attr('height', height);

			// Add zoom behavior
			zoom = d3.zoom()
				.scaleExtent([0.1, 4])
				.on('zoom', (event) => {
					svg.select('g').attr('transform', event.transform);
				});

			svg.call(zoom);

			const g = svg.append('g');

			// Create force simulation
			simulation = d3.forceSimulation(graphData.nodes)
				.force('link', d3.forceLink(graphData.edges).id(d => d.id).distance(100))
				.force('charge', d3.forceManyBody().strength(-300))
				.force('center', d3.forceCenter(width / 2, height / 2))
				.force('collision', d3.forceCollide().radius(30));

			// Draw edges
			const link = g.append('g')
				.selectAll('line')
				.data(graphData.edges)
				.enter()
				.append('line')
				.attr('class', d => 'edge ' + d.type)
				.attr('stroke-width', 2);

			// Draw nodes
			const node = g.append('g')
				.selectAll('circle')
				.data(graphData.nodes)
				.enter()
				.append('circle')
				.attr('class', 'node')
				.attr('r', 10)
				.attr('fill', d => {
					switch(d.type) {
						case 'file': return '#4EC9B0';
						case 'function': return '#DCDCAA';
						case 'class': return '#4FC1FF';
						default: return '#CE9178';
					}
				})
				.call(drag(simulation))
				.on('click', (event, d) => {
					vscode.postMessage({
						command: 'openFile',
						uri: d.uri
					});
				});

			// Add labels
			const label = g.append('g')
				.selectAll('text')
				.data(graphData.nodes)
				.enter()
				.append('text')
				.attr('class', 'label')
				.text(d => d.label.length > 20 ? d.label.substring(0, 20) + '...' : d.label)
				.attr('dx', 12)
				.attr('dy', 4);

			// Update positions on tick
			simulation.on('tick', () => {
				link
					.attr('x1', d => d.source.x)
					.attr('y1', d => d.source.y)
					.attr('x2', d => d.target.x)
					.attr('y2', d => d.target.y);

				node
					.attr('cx', d => d.x)
					.attr('cy', d => d.y);

				label
					.attr('x', d => d.x)
					.attr('y', d => d.y);
			});
		}

		function drag(simulation) {
			function dragstarted(event) {
				if (!event.active) simulation.alphaTarget(0.3).restart();
				event.subject.fx = event.subject.x;
				event.subject.fy = event.subject.y;
			}

			function dragged(event) {
				event.subject.fx = event.x;
				event.subject.fy = event.y;
			}

			function dragended(event) {
				if (!event.active) simulation.alphaTarget(0);
				event.subject.fx = null;
				event.subject.fy = null;
			}

			return d3.drag()
				.on('start', dragstarted)
				.on('drag', dragged)
				.on('end', dragended);
		}

		function refreshGraph() {
			vscode.postMessage({ command: 'refresh' });
		}

		function resetZoom() {
			svg.transition().duration(750).call(
				zoom.transform,
				d3.zoomIdentity
			);
		}

		// Handle window resize
		window.addEventListener('resize', () => {
			const container = d3.select('#graph-container');
			const width = container.node().clientWidth;
			const height = container.node().clientHeight;
			svg.attr('width', width).attr('height', height);
			simulation.force('center', d3.forceCenter(width / 2, height / 2));
			simulation.alpha(1).restart();
		});

		// Initialize
		initGraph();
	</script>
</body>
</html>`;
	}
}


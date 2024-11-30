"use client";
import { useState, useCallback, useEffect } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  Edge,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import * as ts from "typescript";
import { Node } from "reactflow";
import TypeScriptAnalyzer from "./_utils/analyze2";
import { readFileSync } from 'fs';
import { getFile } from "./actions";

const analyzer = new TypeScriptAnalyzer();

const QueueNode = ({ data }: { data: NodeDataType['data'] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-blue-500">
    <Handle type="source" position={Position.Bottom} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-blue-500">
          {data.name}
        </div>
        <div className="text-gray-500">{data.controller}</div>
      </div>
    </div>
  </div>
);

// Custom node types
const EndpointNode = ({ data }: { data: NodeDataType['data'] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-blue-500">
    <Handle type="source" position={Position.Bottom} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-blue-500">
          {data.method} {data.path}
        </div>
        <div className="text-gray-500">{data.controller}</div>
      </div>
    </div>
  </div>
);

const HandlerNode = ({ data }: { data: NodeDataType['data'] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-green-500">
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-green-500">{data.name}</div>
        <div className="text-gray-500">{data.controller}</div>
      </div>
    </div>
  </div>
);

const DatabaseNode = ({ data }: { data: NodeDataType['data'] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-purple-500">
    <Handle type="target" position={Position.Top} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-purple-500">{data?.table || ''}</div>
        <div className="text-gray-500">{data?.action || ''}</div>
      </div>
    </div>
  </div>
);
const ControllerNode = ({ data }: { data: NodeDataType['data'] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-purple-500">
    <Handle type="target" position={Position.Top} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-purple-500">{data?.name}</div>
      </div>
    </div>
  </div>
);

type NodeTypes = 'endpoint' | 'handler' | 'database' | 'queue' | 'function';

type NodeDataType = {
 id: string;
 type: NodeTypes;
  position: { x: number; y: number };
  data: {
    method?: string;
    path?: string;
    controller?: string;
    handler?: string;
    table?: string;
    action?: string;
    name?: string;
  };
}

const nodeTypes = {
  endpoint: EndpointNode,
  handler: HandlerNode,
  database: DatabaseNode,
  queue: QueueNode,
  controller: ControllerNode,
};

export default function APIFlow() {
  const [initialNodes, setInitialNodes] = useState<Node[]>([]);
  const [initialEdges, setInitialEdges] = useState<Edge[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [sourceCode, setSourceCode] = useState<string>('');

  useEffect(() => {
      (async () => {
        try {
          // Read the file you want to analyze
          const fileContent = await getFile('./app/code/test.ts');

        // Analyze the code
        // const result = analyzer.analyze(fileContent);
        const res = await fetch('/api/gemini', {
          method: 'POST',
          body: JSON.stringify({ fileContent }),
        });

        const resultString = await res.json();
        const result = JSON.parse(resultString);
        console.log("result", result);
        setInitialNodes(result.nodes);
        setNodes(result.nodes);
        setInitialEdges(result.edges);
        setEdges(result.edges);
      } catch (error) {
        console.error('Error reading or analyzing file:', error);
      }
    })();
  }, []);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  return (
    <div className="h-screen">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView

        className="bg-gray-50"
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

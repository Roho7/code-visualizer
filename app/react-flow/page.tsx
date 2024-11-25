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

// Custom node types
const EndpointNode = ({ data }: { data: (typeof initialNodes)[0]["data"] }) => (
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

const HandlerNode = ({ data }: { data: (typeof initialNodes)[0]["data"] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-green-500">
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-green-500">{data.handler}</div>
        <div className="text-gray-500">{data.method}</div>
      </div>
    </div>
  </div>
);

const DatabaseNode = ({ data }: { data: (typeof initialNodes)[0]["data"] }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-purple-500">
    <Handle type="target" position={Position.Top} />
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold text-purple-500">{data.table}</div>
        <div className="text-gray-500">{data.action}</div>
      </div>
    </div>
  </div>
);

const initialNodes = [
  // Endpoints
  { 
    id: "get-users",
    type: "endpoint",
    position: { x: 100, y: 0 },
    data: { method: "GET", path: "/users", controller: "UserController" },
  },
  {
    id: "post-users",
    type: "endpoint",
    position: { x: 300, y: 0 },
    data: { method: "POST", path: "/users", controller: "UserController" },
  },
  {
    id: "get-orders",
    type: "endpoint",
    position: { x: 500, y: 0 },
    data: { method: "GET", path: "/orders", controller: "OrderController" },
  },
  {
    id: "post-orders",
    type: "endpoint",
    position: { x: 700, y: 0 },
    data: { method: "POST", path: "/orders", controller: "OrderController" },
  },

  // Handlers
  {
    id: "find-users",
    type: "handler",
    position: { x: 100, y: 100 },
    data: { handler: "UserHandler", method: "findUsers" },
  },
  {
    id: "create-user",
    type: "handler",
    position: { x: 300, y: 100 },
    data: { handler: "UserHandler", method: "createUser" },
  },
  {
    id: "find-orders",
    type: "handler",
    position: { x: 500, y: 100 },
    data: { handler: "OrderHandler", method: "findOrders" },
  },
  {
    id: "create-order",
    type: "handler",
    position: { x: 700, y: 100 },
    data: { handler: "OrderHandler", method: "createOrder" },
  },

  // Database
  {
    id: "users-select",
    type: "database",
    position: { x: 100, y: 200 },
    data: { table: "users", action: "SELECT" },
  },
  {
    id: "users-insert",
    type: "database",
    position: { x: 300, y: 200 },
    data: { table: "users", action: "INSERT" },
  },
  {
    id: "orders-select",
    type: "database",
    position: { x: 500, y: 200 },
    data: { table: "orders", action: "SELECT" },
  },
  {
    id: "orders-insert",
    type: "database",
    position: { x: 700, y: 200 },
    data: { table: "orders", action: "INSERT" },
  },
];

const initialEdges = [
  // Connect endpoints to handlers
  {
    id: "e1",
    source: "get-users",
    target: "find-users",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e2",
    source: "post-users",
    target: "create-user",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e3",
    source: "get-orders",
    target: "find-orders",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e4",
    source: "post-orders",
    target: "create-order",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },

  // Connect handlers to database
  {
    id: "e5",
    source: "find-users",
    target: "users-select",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e6",
    source: "create-user",
    target: "users-insert",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e7",
    source: "find-orders",
    target: "orders-select",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e8",
    source: "create-order",
    target: "orders-insert",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
  },

  // Show order-user relationship
  {
    id: "e9",
    source: "find-orders",
    target: "users-select",
    animated: true,
    style: { stroke: "#999" },
    markerEnd: { type: MarkerType.ArrowClosed },
  },
];

const nodeTypes = {
  endpoint: EndpointNode,
  handler: HandlerNode,
  database: DatabaseNode,
};

export default function APIFlow() {
  // const [nodes, setNodes] = useState<Node[]>();
  // const [edges, setEdges] = useState<Edge[]>([]);
  const [initialNodes, setInitialNodes] = useState<Node[]>([]);
  const [initialEdges, setInitialEdges] = useState<Edge[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [sourceCode, setSourceCode] = useState<string>('');

  useEffect(() => {
      (async () => {
        try {
          // Read the file you want to analyze
          const fileContent = await getFile('./app/react-flow/test.ts');

        // Analyze the code
        const result = analyzer.analyze(fileContent);
        console.log(result);
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

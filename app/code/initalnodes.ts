import { MarkerType } from "reactflow";

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
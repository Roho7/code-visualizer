import * as ts from "typescript";
import { Node } from "reactflow";
export interface HandlerNode {
  id: string;
  type: "handler";
  position: { x: number; y: number }; // This would be set by the UI
  data: {
    handler: string;  // The handler class name
    method: string;   // The method name
    dependencies?: {
      services: string[];
      databases: {
        table: string;
        actions: ("SELECT" | "INSERT" | "UPDATE" | "DELETE")[];
      }[];
      external: {
        type: "api" | "queue";
        name: string;
        endpoints?: string[];
      }[];
    };
  };
}

export function analyzeHandler(sourceFile: ts.SourceFile): Node[] | null {
  const handlerNode: Node = {
    id: crypto.randomUUID(),
    type: "handler",
    position: { x: 0, y: 0 }, // Default position, should be set by UI
    data: {
      handler: "",
      method: "",
      dependencies: {
        services: [],
        databases: [],
        external: [],
      }
    }
  };

  // Visit nodes recursively
  function visit(node: ts.Node): Node[] | null {
    if (ts.isClassDeclaration(node)) {
      handlerNode.data.handler = node.name?.text || "";

      // Analyze constructor for dependencies
      const constructor = node.members.find((m) =>
        ts.isConstructorDeclaration(m),
      );
      if (constructor) {
        const deps = analyzeConstructor(constructor);
        if (deps) {
          handlerNode.data.dependencies = {
            ...handlerNode.data.dependencies,
            services: deps.services,
            databases: deps.databases.map(db => ({
              table: db.name,
              actions: db.actions || ["SELECT", "INSERT", "UPDATE", "DELETE"]
            })),
            external: deps.external
          };
        }
      }

      // Analyze methods
      node.members
        .filter((m) => ts.isMethodDeclaration(m))
        .forEach(method => {
          handlerNode.data.method = method.name.getText();
          // You might want to store method info differently if there are multiple methods
        });

      return [handlerNode];
    }
    
    // Continue searching through child nodes
    for (const child of node.getChildren()) {
      const result = visit(child);
      if (result) return result;
    }
    
    return null;
  }

  return visit(sourceFile);
}

function analyzeConstructor(node: ts.ConstructorDeclaration) {
  const dependencies = {
    services: [] as string[],
    databases: [] as { name: string; actions: ("SELECT" | "INSERT" | "UPDATE" | "DELETE")[] }[],
    external: [] as { type: "api" | "queue"; name: string; endpoints?: string[] }[],
  };

  node.parameters.forEach((param) => {
    const type = param.type?.getText();
    if (type) {
      if (type.endsWith("Service")) {
        dependencies.services.push(type);
      } else if (type.includes("Database")) {
        dependencies.databases.push({
          name: param.name.getText(),
          actions: ["SELECT", "INSERT", "UPDATE", "DELETE"], // Default to all actions
        });
      }
    }
  });

  return dependencies;
}

function analyzeMethod(node: ts.MethodDeclaration) {
  // Extract method info
  const method = {
    name: node.name?.getText() || "",
    type: determineMethodType(node),
    access: getAccessModifier(node),
    // params: getParameters(node),
    calls: analyzeMethodCalls(node),
    decorators: [],
  };

  return method;
}

function analyzeMethodCalls(node: ts.Node) {
  const calls = {
    internal: [] as string[],
    external: [] as {
      type: string;
      target: string;
      action: string;
    }[],
  };

  // Visit all nodes to find method calls
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression.getText();
        const action = node.expression.name.getText();

        // Determine if internal or external call
        if (isExternalCall(target)) {
          calls.external.push({
            type: determineCallType(target),
            target,
            action,
          });
        } else {
          calls.internal.push(action);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(node);
  return calls;
}

/**
 * Determines the type of method based on naming conventions and decorators
 * Types: 'processor' | 'action' | 'validator' | 'helper'
 */
function determineMethodType(node: ts.MethodDeclaration): string {
  const methodName = node.name.getText();
  //   const decorators = getDecorators(node);

  // Check naming patterns
  if (methodName.startsWith("process")) {
    return "processor";
  }
  if (methodName.startsWith("handle") || methodName.startsWith("send")) {
    return "action";
  }
  if (methodName.startsWith("validate")) {
    return "validator";
  }
  if (methodName.startsWith("get") || methodName.startsWith("check")) {
    return "helper";
  }

  // Check decorators
  //   if (
  //     decorators.some(
  //       (d: string) => d.includes("Process") || d.includes("Processor"),
  //     )
  //   ) {
  //     return "processor";
  //   }
  //   if (
  //     decorators.some(
  //       (d: string) => d.includes("Action") || d.includes("Handler"),
  //     )
  //   ) {
  //     return "action";
  //   }
  //   if (
  //     decorators.some(
  //       (d: string) => d.includes("Validate") || d.includes("Validator"),
  //     )
  //   ) {
  //     return "validator";
  //   }

  // Default to helper if no specific pattern is matched
  return "helper";
}

/**
 * Gets the access modifier of a method
 * Returns: 'public' | 'private' | 'protected'
 */
function getAccessModifier(
  node: ts.MethodDeclaration,
): "public" | "private" | "protected" {
  if (node.modifiers) {
    for (const modifier of node.modifiers) {
      if (modifier.kind === ts.SyntaxKind.PrivateKeyword) {
        return "private";
      }
      if (modifier.kind === ts.SyntaxKind.ProtectedKeyword) {
        return "protected";
      }
      if (modifier.kind === ts.SyntaxKind.PublicKeyword) {
        return "public";
      }
    }
  }
  // Default to public if no modifier is specified
  return "public";
}

/**
 * Determines if a method call is to an external service/dependency
 */
function isExternalCall(target: string): boolean {
  // List of known external services and dependencies
  const externalServices = [
    "supabaseAdmin",
    "axios",
    "pg_execute",
    "this.slack",
    "this.broadcastMessageInfoQueue",
    "this.broadcastProgressQueue",
    "EventHandler",
    "SlackWebhook",
  ];

  // Database-related patterns
  const databasePatterns = [
    "repository",
    "dao",
    "db",
    "database",
    "query",
    "transaction",
  ];

  // API-related patterns
  const apiPatterns = ["api", "client", "http", "request", "fetch"];

  return (
    externalServices.some((service) => target.includes(service)) ||
    databasePatterns.some((pattern) =>
      target.toLowerCase().includes(pattern),
    ) ||
    apiPatterns.some((pattern) => target.toLowerCase().includes(pattern)) ||
    target.startsWith("this.") // Class member calls are considered external
  );
}

/**
 * Determines the type of external call
 * Returns: 'database' | 'api' | 'queue' | 'service'
 */
function determineCallType(target: string): string {
  // Database operations
  if (
    target.includes("supabaseAdmin") ||
    target.includes("pg_execute") ||
    target.includes("repository") ||
    target.includes("dao")
  ) {
    return "database";
  }

  // API calls
  if (
    target.includes("axios") ||
    target.includes("fetch") ||
    target.includes("http") ||
    target.includes("request")
  ) {
    return "api";
  }

  // Queue operations
  if (
    target.includes("Queue") ||
    target.includes("queue") ||
    target.includes("EventHandler")
  ) {
    return "queue";
  }

  // External services
  if (target.includes("Service") || target.includes("Client")) {
    return "service";
  }

  // System/utility operations
  if (target.includes("logger") || target.includes("this.slack")) {
    return "utility";
  }

  return "unknown";
}

/**
 * Additional helper: Get method documentation
 */
// function getMethodDocumentation(node: ts.MethodDeclaration): {
//   description?: string;
//   params?: { name: string; description: string }[];
//   returns?: string;
//   pointers?: string[];
// } {
//   const docs = ts.getJSDocCommentRanges(node, node.getSourceFile().text);
//   if (!docs || docs.length === 0) return {};

//   const docString = node.getSourceFile().text.slice(docs[0].pos, docs[0].end);

//   // Parse JSDoc-style comments
//   const description = docString.match(/@description\s+([^@]*)/)?.[1]?.trim();
//   const params = [...docString.matchAll(/@param\s+(\w+)\s+([^@]*)/g)].map(match => ({
//     name: match[1],
//     description: match[2].trim()
//   }));
//   const returns = docString.match(/@returns\s+([^@]*)/)?.[1]?.trim();
//   const pointers = [...docString.matchAll(/@pointer\s+(\w+)/g)].map(match => match[1]);

//   return {
//     description,
//     params,
//     returns,
//     pointers
//   };
// }

/**
 * Additional helper: Analyze method complexity
 */
function analyzeMethodComplexity(node: ts.MethodDeclaration): {
  cyclomaticComplexity: number;
  numberOfStatements: number;
  depth: number;
} {
  let complexity = 1; // Base complexity
  let statements = 0;
  let maxDepth = 0;
  let currentDepth = 0;

  function visit(node: ts.Node) {
    // Increase complexity for control flow statements
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCaseClause(node) ||
      ts.isConditionalExpression(node)
    ) {
      complexity++;
    }

    // Track nesting depth
    if (
      ts.isBlock(node) ||
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isWhileStatement(node)
    ) {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    // Count statements
    if (ts.isStatement(node) && !ts.isBlock(node)) {
      statements++;
    }

    ts.forEachChild(node, visit);

    // Decrease depth when leaving a block
    if (
      ts.isBlock(node) ||
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isWhileStatement(node)
    ) {
      currentDepth--;
    }
  }

  visit(node.body!);

  return {
    cyclomaticComplexity: complexity,
    numberOfStatements: statements,
    depth: maxDepth,
  };
}

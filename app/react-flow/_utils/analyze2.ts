import * as ts from 'typescript';

interface CodeNode {
  id: string;
  type: 'function' | 'class' | 'interface' | 'call';
  data: {
    label: string;
    details?: string;
  };
  position: { x: number; y: number };
}

interface CodeEdge {
  id: string;
  source: string;
  target: string;
  type?: 'default' | 'calls' | 'implements' | 'extends';
}

interface AnalyzerResult {
  nodes: CodeNode[];
  edges: CodeEdge[];
}

interface VisitedNode {
  id: string;
  name: string;
  type: CodeNode['type'];
}

class TypeScriptAnalyzer {
  private nodes: CodeNode[] = [];
  private edges: CodeEdge[] = [];
  private visitedNodes: VisitedNode[] = [];
  private nodeCounter = 0;
  private currentX = 0;
  private currentY = 0;
  private packagesToIgnore: string[] = [
    'console',
    'logger',
    'supabase',
    'dayjs',
    'moment',
    'axios',
    'fetch',
    'localStorage',
    'JSON',
    'Object',
    'supabaseAdmin',
    'Math',
    'Date',
    'Error',
    'map',
    'from',
    'to',
    'Array',
    'Set',
    'Map',
    'Promise',
    'pg_execute'
    // Add more packages as needed
  ];

  public analyze(sourceCode: string): AnalyzerResult {
    this.nodes = [];
    this.edges = [];
    this.visitedNodes = [];
    this.nodeCounter = 0;
    this.currentX = 0;
    this.currentY = 0;

    const sourceFile = ts.createSourceFile(
      'analyzed.ts',
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    this.visitNode(sourceFile);

    return {
      nodes: this.nodes,
      edges: this.edges
    };
  }

  private createNodeId(): string {
    return `node-${++this.nodeCounter}`;
  }

  private findVisitedNode(name: string, type: CodeNode['type']): VisitedNode | undefined {
    return this.visitedNodes.find(node => node.name === name && node.type === type);
  }

  private addNode(type: CodeNode['type'], name: string, details?: string): string {
    const existingNode = this.findVisitedNode(name, type);
    if (existingNode) {
      return existingNode.id;
    }

    const id = this.createNodeId();
    const node: CodeNode = {
      id,
      type,
      data: {
        label: name,
        details
      },
      position: {
        x: this.currentX,
        y: this.currentY
      }
    };

    this.nodes.push(node);
    this.visitedNodes.push({ id, name, type });
    
    this.currentY += 100;
    if (this.currentY > 500) {
      this.currentY = 0;
      this.currentX += 250;
    }

    return id;
  }

  private addEdge(source: string, target: string, type: CodeEdge['type'] = 'default'): void {
    const edge: CodeEdge = {
      id: `edge-${source}-${target}`,
      source,
      target,
      type
    };
    this.edges.push(edge);
  }

  private visitNode(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node)) {
      const functionName = node.name?.getText().split('.')[1] || 'anonymous';
      const params = node.parameters.map(p => p.getText()).join(', ');
      const returnType = node.type ? `: ${node.type.getText()}` : '';
      const details = `(${params})${returnType}`;
      const nodeId = this.addNode('function', functionName, details);

      // Analyze function body for calls
      if (node.body) {
        this.analyzeFunctionBody(node.body, nodeId);
      }
    }
    else if (ts.isClassDeclaration(node)) {
      const className = node.name?.getText() || 'anonymous';
      const nodeId = this.addNode('class', className);

      // Handle inheritance
      if (node.heritageClauses) {
        node.heritageClauses.forEach(clause => {
          clause.types.forEach(type => {
            const baseClassName = type.expression.getText();
            const baseClassId = this.addNode('class', baseClassName);
            this.addEdge(nodeId, baseClassId, clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements');
          });
        });
      }

      // Analyze class members
      node.members.forEach(member => {
        if (ts.isMethodDeclaration(member)) {
          const methodName = member.name.getText();
          const methodId = this.addNode('function', `${methodName}`);
          this.addEdge(nodeId, methodId);

          if (member.body) {
            this.analyzeFunctionBody(member.body, methodId);
          }
        }
      });
    }
    else if (ts.isInterfaceDeclaration(node)) {
      const interfaceName = node.name.getText();
      const nodeId = this.addNode('interface', interfaceName);

      // Handle interface extensions
      if (node.heritageClauses) {
        node.heritageClauses.forEach(clause => {
          clause.types.forEach(type => {
            const baseInterfaceName = type.expression.getText();
            const baseId = this.addNode('interface', baseInterfaceName);
            this.addEdge(nodeId, baseId, 'extends');
          });
        });
      }
    }

    ts.forEachChild(node, child => this.visitNode(child));
  }

  private isExternalPackageCall(functionName: string): boolean {
    // Check direct matches with packagesToIgnore
    for (const packageName of this.packagesToIgnore) {
      if (functionName.startsWith(packageName)) {
        return true;
      }
    }
    // if (this.packagesToIgnore.has(functionName.split('.')[0] || '')) {
    //   console.log('functionName', functionName);
    //   return true;
    // }

    // Check for common patterns of package usage
    const isLikelyPackage = 
      // Starts with lowercase and contains a dot (typical package.method pattern)
      /^[a-z].*\..*/.test(functionName) ||
      // Starts with $ (like jQuery)
      functionName.startsWith('$') ||
      // Starts with _ (like lodash)
      functionName.startsWith('_');

    return isLikelyPackage;
  }

  private analyzeFunctionBody(body: ts.Node, functionNodeId: string): void {
    const visitCallExpression = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const calledFunction = node.expression.getText();
        
        // Skip if it's an external package call
        if (this.isExternalPackageCall(calledFunction)) {
          return;
        }

        const existingNode = this.findVisitedNode(calledFunction, 'function');
        const callNodeId = existingNode ? existingNode.id : this.addNode('call', calledFunction);
        this.addEdge(functionNodeId, callNodeId, 'calls');
      }
      ts.forEachChild(node, visitCallExpression);
    };

    visitCallExpression(body);
  }
}

export default TypeScriptAnalyzer;
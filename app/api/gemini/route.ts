import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();



  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" , generationConfig: {
    temperature: 0,
    responseMimeType: "application/json",
  }});


  const prompt = `
    You are a code architect that understands Typescript code and produces a React Flow diagram that represents the code.
    You will be given a list of files and their contents.
    You will then produce a React Flow diagram that represents the code.
    The React Flow diagram should be in JSON format.
    This is the list of files: ${body.fileContent}
    The accepted format for the React Flow diagram is as follows:
    {
        nodes: [
            { 
                id: "<unique-name-of-endpoint>",
    type: "endpoint",
    position: { x: <number>, y: <number> },
    data: { method: "<http-method>", path: "/<path>", name: "<name-of-controller>" },
  },
  {
    id: "<unique-name-of-controller>",
    type: "controller",
    position: { x: <number>, y: <number> },
    data: { name: "<name-of-controller>" },
  },
  {
    id: "<unique-name-of-handler>",
    type: "handler",
    position: { x: <number>, y: <number> },
    parentId: "<id-of-controller>",
    data: { name: "<name-of-handler>" },
  },
  {
    id: "<unique-name-of-function>",
    type: "function",
    position: { x: <number>, y: <number> },
    data: { name: "<name-of-function>" },
  },
  {
    id: "<unique-name-of-database-operation>",
    type: "database",
    position: { x: <number>, y: <number> },
    data: { table: "<name-of-table>", name: "<action>" },
}],
        edges: [
            {
                id: "<unique-name-of-edge>",
                source: "<id-of-source-node>",
                target: "<id-of-target-node>",
            }
        ]
    }
    Expand this JSON to include all the endpoints, handlers, and database operations that are defined in the code.
    Adjust the position of the nodes so that they are not overlapping. And organize them in a logical manner.
    Do not duplicate a node. Same function calls and classes should be represented by the same node.
    You will only return the JSON object and nothing else. You will not include any other text or comments. You will not return markdown or use backticks.
    `;
  console.log(body);
  const result = await model.generateContent(prompt);
  console.log(result.response.text());

  return NextResponse.json(result.response.text());
}

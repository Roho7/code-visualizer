'use server'
import { readFile, readFileSync } from "fs";

export async function getFile(filePath: string) {
    const fileContent = readFileSync(filePath, 'utf-8');
    return fileContent.toString();
}

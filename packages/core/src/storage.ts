import {
  appendFile,
  type FileHandle,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import readline from "node:readline";
import type { LedgerEvent } from "@skarp/schema";
import type { SessionStore, StoragePort } from "./ports.ts";

export class Storage implements StoragePort {
  async append(file: string, line: string): Promise<void> {
    try {
      // Ensure the parent directory exists
      await mkdir(dirname(file), { recursive: true });

      const lineToAppend = line.endsWith("\n") ? line : `${line}\n`;
      await appendFile(file, lineToAppend, "utf8");
    } catch (error) {
      console.error("Failed to append to JSONL file:", error);
      throw error; // rethrow the error after logging it
    }
  }

  async readAll(dir: string): Promise<string[]> {
    if (!(await this.ensureDirExists(dir))) {
      return [];
    }

    const files = await this.findJsonlFilesOnly(dir);
    const eventMap: Record<string, string> = {};
    for (const file of files) {
      const events = await this.readAllFromJsonl(file);

      for (const event of events) {
        // keep only unique events based on their 'id' property
        if (event.id && !eventMap[event.id]) {
          eventMap[event.id] = JSON.stringify(event);
        }
      }
    }

    return Object.values(eventMap);
  }

  async removeAll(dir: string): Promise<void> {
    for (const file of await this.findJsonlFilesOnly(dir)) await rm(file, { force: true });
  }

  private async ensureDirExists(dir: string): Promise<boolean> {
    try {
      const folder_stat = await stat(dir);
      return folder_stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Scans a single directory for .jsonl files (non-recursive).
   * @param dirPath The folder to scan.
   * @returns A promise resolving to an array of full file paths.
   */
  private async findJsonlFilesOnly(dirPath: string): Promise<string[]> {
    try {
      // Read all files and folders in the target directory
      const entries = await readdir(dirPath, { withFileTypes: true });

      // Filter out directories and keep only files ending with .jsonl
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => join(dirPath, entry.name));
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
      return [];
    }
  }

  /**
   * Reads a JSONL file and returns all lines as an array of JSON objects.
   * @param filePath Path to the target .jsonl file
   */
  private async readAllFromJsonl(filePath: string): Promise<LedgerEvent[]> {
    const objects: LedgerEvent[] = [];
    let fileHandle: FileHandle | undefined;

    try {
      // 1. Open the file for reading
      fileHandle = await open(filePath, "r");

      // 2. Create a stream interface to read line-by-line
      const rl = readline.createInterface({
        input: fileHandle.createReadStream(),
        crlfDelay: Infinity,
      });

      // 3. Parse each line individually
      for await (const line of rl) {
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) continue;

        try {
          const parsedObject = JSON.parse(trimmedLine) as LedgerEvent;
          objects.push(parsedObject);
        } catch {
          console.warn("Skipping malformed or invalid JSON line:", trimmedLine);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.error(`File not found: ${filePath}`);
      } else {
        console.error("Error reading JSONL file:", error);
      }
    } finally {
      // 4. Ensure the file stream is safely closed
      await fileHandle?.close();
    }

    return objects;
  }
}

// ~/.skarp/sessions/<id>/session.json, rewritten after every message.
// Ids reach here from the webview, so only plain names are allowed (no "../").
export class FileSessions implements SessionStore {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private file(id: string) {
    if (!/^[\w-]{1,100}$/.test(id)) throw new Error(`Bad session id: ${id}`);
    return join(this.dir, id, "session.json");
  }

  async save(id: string, data: string) {
    const file = this.file(id);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data, "utf8");
  }

  async load(id: string) {
    return readFile(this.file(id), "utf8").catch(() => undefined);
  }

  async list() {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  async remove(id: string) {
    await rm(dirname(this.file(id)), { recursive: true, force: true });
  }
}

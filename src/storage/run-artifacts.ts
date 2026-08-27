import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export class RunArtifacts {
  readonly runId: string;
  readonly runDirectory: string;

  constructor(
    rootDirectory: string,
    runId = createRunId(),
    private readonly onWriteError?: (error: unknown, relativePath: string) => void
  ) {
    this.runId = runId;
    this.runDirectory = resolve(rootDirectory, "runs", runId);
  }

  async write(relativePath: string, value: unknown): Promise<void> {
    await this.writeText(relativePath, JSON.stringify(value, null, 2) + "\n");
  }

  async writeText(relativePath: string, value: string): Promise<void> {
    try {
      const target = resolve(this.runDirectory, relativePath);
      if (target !== this.runDirectory && !target.startsWith(this.runDirectory + sep)) {
        throw new Error("Artifact path escaped the run directory.");
      }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, value, "utf8");
      await rename(temporary, target);
    } catch (error) {
      this.onWriteError?.(error, relativePath);
      throw error;
    }
  }
}

function createRunId(): string {
  return `${new Date().toISOString().replace(/[-:.]/gu, "")}-${randomUUID().slice(0, 8)}`;
}

const fileSystem = await import("node:fs");

export interface CommandStateFilePort {
  readonly exists: (filePath: string) => boolean;
  readonly readText: (filePath: string) => string;
}

export const nodeCommandStateFilePort: CommandStateFilePort = {
  exists: (filePath) => fileSystem.existsSync(filePath),
  readText: (filePath) => fileSystem.readFileSync(filePath, "utf8"),
};

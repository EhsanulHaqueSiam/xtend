interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
}

export function readWorkspace(): Array<WorkspacePackage>;

export function decide(
  files: ReadonlyArray<string> | null,
  packages: ReadonlyArray<WorkspacePackage>,
): {
  affected: Array<string>;
  outputs: { build: boolean; test: boolean };
};

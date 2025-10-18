let silentMode = false;
let verboseMode = false;

export function setSilentMode(value: boolean): void {
  silentMode = value;
}

export function isSilentMode(): boolean {
  return silentMode;
}

export function setVerboseMode(value: boolean): void {
  verboseMode = value;
}

export function isVerboseMode(): boolean {
  return verboseMode;
}

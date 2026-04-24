import { randomUUID } from "node:crypto";

export function makeUid(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

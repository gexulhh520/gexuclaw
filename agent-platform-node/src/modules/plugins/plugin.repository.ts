import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { plugins } from "../../db/schema.js";
import { makeUid } from "../../shared/ids.js";
import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";

export type PluginRecord = typeof plugins.$inferSelect;

export type CreatePluginInput = {
  pluginUid?: string;
  pluginId: string;
  name: string;
  description?: string;
  pluginType: string;
  providerType: string;
  version?: string;
  sourceRef?: string;
  manifestJson?: Record<string, unknown>;
  configJson?: Record<string, unknown>;
  installed?: boolean;
  enabled?: boolean;
  status?: string;
};

export type UpdatePluginInput = Partial<Omit<CreatePluginInput, "pluginId">>;

export async function listPlugins(): Promise<PluginRecord[]> {
  return db.select().from(plugins).orderBy(plugins.id);
}

export async function listEnabledPlugins(): Promise<PluginRecord[]> {
  return db.select().from(plugins).where(eq(plugins.enabled, true)).orderBy(plugins.id);
}

export async function getPluginById(pluginId: string): Promise<PluginRecord | undefined> {
  const [record] = await db.select().from(plugins).where(eq(plugins.pluginId, pluginId));
  return record;
}

export async function getPluginByUid(pluginUid: string): Promise<PluginRecord | undefined> {
  const [record] = await db.select().from(plugins).where(eq(plugins.pluginUid, pluginUid));
  return record;
}

export async function createPlugin(input: CreatePluginInput): Promise<PluginRecord> {
  const now = nowIso();
  const [record] = await db
    .insert(plugins)
    .values({
      pluginUid: input.pluginUid ?? makeUid("plugin"),
      pluginId: input.pluginId,
      name: input.name,
      description: input.description ?? "",
      pluginType: input.pluginType,
      providerType: input.providerType,
      version: input.version ?? "1",
      sourceRef: input.sourceRef,
      manifestJson: jsonStringify(input.manifestJson ?? {}),
      configJson: jsonStringify(input.configJson ?? {}),
      installed: input.installed ?? false,
      enabled: input.enabled ?? true,
      status: input.status ?? "registered",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return record;
}

export async function updatePlugin(
  pluginId: string,
  input: UpdatePluginInput
): Promise<PluginRecord> {
  const now = nowIso();
  const [record] = await db
    .update(plugins)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.pluginType !== undefined && { pluginType: input.pluginType }),
      ...(input.providerType !== undefined && { providerType: input.providerType }),
      ...(input.version !== undefined && { version: input.version }),
      ...(input.sourceRef !== undefined && { sourceRef: input.sourceRef }),
      ...(input.manifestJson !== undefined && { manifestJson: jsonStringify(input.manifestJson) }),
      ...(input.configJson !== undefined && { configJson: jsonStringify(input.configJson) }),
      ...(input.installed !== undefined && { installed: input.installed }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.status !== undefined && { status: input.status }),
      updatedAt: now,
    })
    .where(eq(plugins.pluginId, pluginId))
    .returning();
  return record;
}

export async function upsertPlugin(input: CreatePluginInput): Promise<PluginRecord> {
  const existing = await getPluginById(input.pluginId);
  if (existing) {
    return updatePlugin(input.pluginId, input);
  }
  return createPlugin(input);
}

export async function markPluginStatus(
  pluginId: string,
  status: string,
  lastError?: string
): Promise<void> {
  await db
    .update(plugins)
    .set({
      status,
      ...(lastError !== undefined && { lastError }),
      updatedAt: nowIso(),
    })
    .where(eq(plugins.pluginId, pluginId));
}

export async function enablePlugin(pluginId: string): Promise<void> {
  await db
    .update(plugins)
    .set({ enabled: true, status: "active", updatedAt: nowIso() })
    .where(eq(plugins.pluginId, pluginId));
}

export async function disablePlugin(pluginId: string): Promise<void> {
  await db
    .update(plugins)
    .set({ enabled: false, status: "disabled", updatedAt: nowIso() })
    .where(eq(plugins.pluginId, pluginId));
}

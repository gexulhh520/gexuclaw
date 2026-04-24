import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { agents, agentVersions } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import { getModelProfileByUid } from "../model-profiles/model-profile.service.js";
import type { CreateAgentInput, CreateAgentVersionInput } from "./agent.schema.js";

export async function createAgent(input: CreateAgentInput) {
  const now = nowIso();

  const [agent] = await db
    .insert(agents)
    .values({
      agentUid: input.agentUid ?? makeUid("agent"),
      name: input.name,
      type: input.type,
      description: input.description,
      capabilitiesJson: jsonStringify(input.capabilities),
      ownerUserId: input.ownerUserId,
      standaloneEnabled: input.standaloneEnabled,
      subagentEnabled: input.subagentEnabled,
      uiMode: input.uiMode,
      uiRoute: input.uiRoute,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return agent;
}

export async function listAgents() {
  return db.select().from(agents).orderBy(agents.id);
}

export async function getAgentByUid(agentUid: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.agentUid, agentUid));
  return agent;
}

export async function createAgentVersion(agentUid: string, input: CreateAgentVersionInput) {
  const agent = await getAgentByUid(agentUid);
  if (!agent) throw notFound("Agent not found", { agentUid });

  const profile = await getModelProfileByUid(input.modelProfileUid);
  if (!profile) throw notFound("ModelProfile not found", { modelProfileUid: input.modelProfileUid });

  // AgentVersion 是不可变运行版本。每次发布都递增 version，
  // Agent.current_version_id 只指向当前默认运行版本。
  const latest = await listAgentVersions(agentUid);
  const versionNumber = latest.length > 0 ? latest[0].version + 1 : 1;
  const now = nowIso();

  const [version] = await db
    .insert(agentVersions)
    .values({
      agentId: agent.id,
      version: versionNumber,
      modelProfileId: profile.id,
      systemPrompt: input.systemPrompt,
      skillText: input.skillText,
      allowedToolsJson: jsonStringify(input.allowedTools),
      contextPolicyJson: jsonStringify(input.contextPolicy),
      modelParamsOverrideJson: jsonStringify(input.modelParamsOverride),
      outputSchemaJson: jsonStringify(input.outputSchema),
      maxSteps: input.maxSteps,
      status: "published",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.update(agents).set({ currentVersionId: version.id, updatedAt: now }).where(eq(agents.id, agent.id));
  return version;
}

export async function listAgentVersions(agentUid: string) {
  const agent = await getAgentByUid(agentUid);
  if (!agent) throw notFound("Agent not found", { agentUid });

  return db
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agent.id))
    .orderBy(desc(agentVersions.version));
}

export async function getCurrentAgentVersion(agentUid: string) {
  const agent = await getAgentByUid(agentUid);
  if (!agent) throw notFound("Agent not found", { agentUid });
  if (!agent.currentVersionId) throw notFound("Agent has no published version", { agentUid });

  const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, agent.currentVersionId));
  if (!version) throw notFound("Agent current version not found", { agentUid });

  return { agent, version };
}

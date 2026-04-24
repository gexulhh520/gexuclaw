import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { modelProfiles } from "../../db/schema.js";
import { jsonStringify } from "../../shared/json.js";
import { makeUid } from "../../shared/ids.js";
import { nowIso } from "../../shared/time.js";
import type { CreateModelProfileInput } from "./model-profile.schema.js";

export async function createModelProfile(input: CreateModelProfileInput) {
  const now = nowIso();

  // ModelProfile 是模型能力的稳定抽象。
  // AgentVersion 绑定它之后，后续切 provider 或模型名时只需要新增 profile 或版本。
  const [profile] = await db
    .insert(modelProfiles)
    .values({
      profileUid: input.profileUid ?? makeUid("model_profile"),
      name: input.name,
      provider: input.provider,
      modelName: input.modelName,
      baseUrl: input.baseUrl,
      capabilityJson: jsonStringify(input.capability),
      defaultParamsJson: jsonStringify(input.defaultParams),
      maxContextTokens: input.maxContextTokens,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return profile;
}

export async function listModelProfiles() {
  return db.select().from(modelProfiles).orderBy(modelProfiles.id);
}

export async function getModelProfileByUid(profileUid: string) {
  // 统一通过 profile_uid 查业务对象，避免前端依赖数据库自增 id。
  const [profile] = await db.select().from(modelProfiles).where(eq(modelProfiles.profileUid, profileUid));
  return profile;
}

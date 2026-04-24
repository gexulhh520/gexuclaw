import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { notFound } from "../../shared/errors.js";
import { makeUid } from "../../shared/ids.js";
import { jsonStringify } from "../../shared/json.js";
import { nowIso } from "../../shared/time.js";
import type { CreateProjectInput } from "./project.schema.js";

export async function createProject(input: CreateProjectInput) {
  const now = nowIso();

  const [project] = await db
    .insert(projects)
    .values({
      projectUid: makeUid("project"),
      name: input.name,
      description: input.description ?? "",
      icon: input.icon ?? "📁",
      metadataJson: jsonStringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return project;
}

export async function listProjects(limit = 20) {
  return db
    .select()
    .from(projects)
    .orderBy(desc(projects.id))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getProjectByUid(projectUid: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.projectUid, projectUid));

  if (!project) {
    throw notFound("Project not found", { projectUid });
  }

  return project;
}

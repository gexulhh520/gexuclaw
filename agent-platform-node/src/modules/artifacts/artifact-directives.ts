import { ArtifactRoleEnum, ArtifactTypeEnum } from "../work-contexts/work-context.schema.js";

export type AgentArtifactDecision = {
  candidateId: string;
  keep: boolean;
  artifactRole?: "input" | "reference" | "intermediate" | "draft" | "final" | "output" | "pending_write";
  title?: string;
};

export type AgentDeclaredArtifact = {
  artifactType: "text" | "structured_data" | "page" | "image" | "link" | "file" | "collection";
  artifactRole: "input" | "reference" | "intermediate" | "draft" | "final" | "output" | "pending_write";
  title: string;
  contentText?: string;
  contentJson?: Record<string, unknown> | unknown[];
  uri?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  sourceArtifactIds?: string[];
};

export type ParsedArtifactDirectives = {
  cleanContent: string;
  artifactDecisions: AgentArtifactDecision[];
  declaredArtifacts: AgentDeclaredArtifact[];
};

export type ArtifactDirectiveMode = "decision_only" | "full";

export type ArtifactDirectiveConfig = {
  enabled: boolean;
  mode: ArtifactDirectiveMode;
};

const ARTIFACT_DIRECTIVES_TAG = "artifact_directives";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDecision(raw: unknown): AgentArtifactDecision | null {
  if (!isRecord(raw)) return null;
  const candidateId = typeof raw.candidateId === "string" ? raw.candidateId.trim() : "";
  const keep = typeof raw.keep === "boolean" ? raw.keep : true;
  const role = typeof raw.artifactRole === "string" ? ArtifactRoleEnum.safeParse(raw.artifactRole) : null;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined;

  if (!candidateId) return null;

  return {
    candidateId,
    keep,
    artifactRole: role?.success ? role.data : undefined,
    title,
  };
}

function normalizeDeclaredArtifact(raw: unknown): AgentDeclaredArtifact | null {
  if (!isRecord(raw)) return null;

  const artifactType = typeof raw.artifactType === "string" ? ArtifactTypeEnum.safeParse(raw.artifactType) : null;
  const artifactRole = typeof raw.artifactRole === "string" ? ArtifactRoleEnum.safeParse(raw.artifactRole) : null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";

  if (!artifactType?.success || !artifactRole?.success || !title) {
    return null;
  }

  const contentJson =
    isRecord(raw.contentJson) || Array.isArray(raw.contentJson) ? raw.contentJson : undefined;
  const metadata = isRecord(raw.metadata) ? raw.metadata : undefined;
  const sourceArtifactIds = Array.isArray(raw.sourceArtifactIds)
    ? raw.sourceArtifactIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;

  return {
    artifactType: artifactType.data,
    artifactRole: artifactRole.data,
    title,
    contentText: typeof raw.contentText === "string" ? raw.contentText : undefined,
    contentJson,
    uri: typeof raw.uri === "string" ? raw.uri : undefined,
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
    metadata,
    sourceArtifactIds,
  };
}

export function parseArtifactDirectiveConfig(contextPolicy: Record<string, unknown>): ArtifactDirectiveConfig {
  const raw = isRecord(contextPolicy.artifactDirectives) ? contextPolicy.artifactDirectives : null;
  const enabled = raw?.enabled === true;
  const mode: ArtifactDirectiveMode =
    raw?.mode === "full" || raw?.mode === "decision_only" ? raw.mode : "decision_only";

  return {
    enabled,
    mode,
  };
}

export function extractArtifactDirectives(content: string): ParsedArtifactDirectives {
  if (!content) {
    return {
      cleanContent: "",
      artifactDecisions: [],
      declaredArtifacts: [],
    };
  }

  const pattern = new RegExp(`<${ARTIFACT_DIRECTIVES_TAG}>([\\s\\S]*?)<\\/${ARTIFACT_DIRECTIVES_TAG}>`, "i");
  const match = content.match(pattern);

  if (!match) {
    return {
      cleanContent: content,
      artifactDecisions: [],
      declaredArtifacts: [],
    };
  }

  let artifactDecisions: AgentArtifactDecision[] = [];
  let declaredArtifacts: AgentDeclaredArtifact[] = [];

  try {
    const parsed = JSON.parse(match[1]);
    if (isRecord(parsed)) {
      artifactDecisions = Array.isArray(parsed.artifactDecisions)
        ? parsed.artifactDecisions.map(normalizeDecision).filter((item): item is AgentArtifactDecision => !!item)
        : [];
      declaredArtifacts = Array.isArray(parsed.declaredArtifacts)
        ? parsed.declaredArtifacts
            .map(normalizeDeclaredArtifact)
            .filter((item): item is AgentDeclaredArtifact => !!item)
        : [];
    }
  } catch (error) {
    console.warn("[ArtifactDirectives] Failed to parse directives:", error);
  }

  const cleanContent = content.replace(match[0], "").trim();

  return {
    cleanContent,
    artifactDecisions,
    declaredArtifacts,
  };
}

import type { Env, QuizQuestionRow, QuizQuestionType } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const QUESTION_TYPES: QuizQuestionType[] = ["multiple_choice", "short_text", "scale_1_10"];

function parseOptions(row: QuizQuestionRow): Omit<QuizQuestionRow, "options"> & { options: string[] | null } {
  return { ...row, options: row.options ? (JSON.parse(row.options) as string[]) : null };
}

export async function listQuizQuestions(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM quiz_questions ORDER BY position ASC",
  ).all<QuizQuestionRow>();
  return jsonResponse({ questions: (results ?? []).map(parseOptions) });
}

export async function createQuizQuestion(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ question_type?: string; prompt?: string; options?: string[] }>()
    .catch(() => ({}) as { question_type?: string; prompt?: string; options?: string[] });

  const questionType = body.question_type as QuizQuestionType;
  if (!QUESTION_TYPES.includes(questionType)) {
    return jsonResponse({ error: "question_type must be one of: " + QUESTION_TYPES.join(", ") }, 400);
  }
  if (!body.prompt || !body.prompt.trim()) {
    return jsonResponse({ error: "A prompt is required." }, 400);
  }
  let options: string[] | null = null;
  if (questionType === "multiple_choice") {
    options = (body.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) {
      return jsonResponse({ error: "Multiple choice questions need at least 2 options." }, 400);
    }
  }

  const maxPos = await env.DB.prepare("SELECT COALESCE(MAX(position), -1) as maxPos FROM quiz_questions").first<{
    maxPos: number;
  }>();
  const position = (maxPos?.maxPos ?? -1) + 1;

  const result = await env.DB.prepare(
    "INSERT INTO quiz_questions (position, question_type, prompt, options) VALUES (?, ?, ?, ?)",
  )
    .bind(position, questionType, body.prompt.trim(), options ? JSON.stringify(options) : null)
    .run();

  return jsonResponse({ id: result.meta.last_row_id }, 201);
}

export async function updateQuizQuestion(
  request: Request,
  env: Env,
  questionId: number,
): Promise<Response> {
  const existing = await env.DB.prepare("SELECT * FROM quiz_questions WHERE id = ?")
    .bind(questionId)
    .first<QuizQuestionRow>();
  if (!existing) return jsonResponse({ error: "Question not found." }, 404);

  const body = await request
    .json<{ question_type?: string; prompt?: string; options?: string[] }>()
    .catch(() => ({}) as { question_type?: string; prompt?: string; options?: string[] });

  const questionType = (body.question_type as QuizQuestionType) ?? existing.question_type;
  if (!QUESTION_TYPES.includes(questionType)) {
    return jsonResponse({ error: "question_type must be one of: " + QUESTION_TYPES.join(", ") }, 400);
  }
  const prompt = body.prompt !== undefined ? body.prompt.trim() : existing.prompt;
  if (!prompt) return jsonResponse({ error: "A prompt is required." }, 400);

  let options: string[] | null = existing.options ? (JSON.parse(existing.options) as string[]) : null;
  if (questionType === "multiple_choice") {
    if (body.options !== undefined) {
      options = body.options.map((o) => o.trim()).filter(Boolean);
    }
    if (!options || options.length < 2) {
      return jsonResponse({ error: "Multiple choice questions need at least 2 options." }, 400);
    }
  } else {
    options = null;
  }

  await env.DB.prepare(
    "UPDATE quiz_questions SET question_type = ?, prompt = ?, options = ? WHERE id = ?",
  )
    .bind(questionType, prompt, options ? JSON.stringify(options) : null, questionId)
    .run();

  return jsonResponse({ ok: true });
}

export async function deleteQuizQuestion(env: Env, questionId: number): Promise<Response> {
  await env.DB.prepare("DELETE FROM quiz_responses WHERE question_id = ?").bind(questionId).run();
  await env.DB.prepare("DELETE FROM quiz_questions WHERE id = ?").bind(questionId).run();
  return jsonResponse({ ok: true });
}

// Body: { ids: number[] } in the desired display order.
export async function reorderQuizQuestions(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ ids?: number[] }>().catch(() => ({}) as { ids?: number[] });
  if (!Array.isArray(body.ids)) {
    return jsonResponse({ error: "ids array is required." }, 400);
  }

  for (let i = 0; i < body.ids.length; i++) {
    await env.DB.prepare("UPDATE quiz_questions SET position = ? WHERE id = ?")
      .bind(i, body.ids[i])
      .run();
  }

  return jsonResponse({ ok: true });
}

const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand, QueryCommand } = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");

const db = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME;

const fallbackQuestions = [
  { id: "q1", text: "Amazon EC2は仮想サーバーを提供するサービスだ。", answer: "aws", fact: "Elastic Compute Cloud (EC2) はAWSのコンピュートサービス。" },
  { id: "q2", text: "Kindle Unlimitedは定額で本を読めるサービスだ。", answer: "amazon", fact: "KindleはAmazonのコンテンツ・デバイス事業。" },
  { id: "q3", text: "Amazon S3はオブジェクトストレージサービスだ。", answer: "aws", fact: "Simple Storage Service (S3) はAWSの代表的なストレージサービス。" },
  { id: "q4", text: "Prime Videoで映画やドラマを配信している。", answer: "amazon", fact: "Prime VideoはAmazonのサブスクリプションサービス。" },
  { id: "q5", text: "IAMロールを使ってアクセス権限を委任できる。", answer: "aws", fact: "Identity and Access Management (IAM) はAWSの認可/認証サービス。" },
  { id: "q6", text: "Amazonフレッシュで生鮮食品を届けてもらえる。", answer: "amazon", fact: "AmazonフレッシュはAmazonの食料品配送サービス。" },
  { id: "q7", text: "CloudWatchはメトリクス監視とログ収集を行う。", answer: "aws", fact: "Amazon CloudWatchはAWSの運用監視サービス。" },
  { id: "q8", text: "AWS Fargateはコンテナ実行のためのサーバーレス基盤だ。", answer: "aws", fact: "FargateはECS/EKS向けのサーバーレスコンテナ実行環境。" },
  { id: "q9", text: "Fire TV Stickはテレビで動画を楽しむためのデバイスだ。", answer: "amazon", fact: "Fire TVデバイスはAmazonのハードウェア製品。" },
  { id: "q10", text: "Route 53はマネージドDNSサービスだ。", answer: "aws", fact: "Amazon Route 53はドメイン管理とDNSルーティングを提供。" }
];

exports.handler = async (event) => {
  const rawPath = event.rawPath || "/";
  const method = event.requestContext?.http?.method || "GET";
  const segments = rawPath.split("/").filter(Boolean);

  if (segments[0] === "api" && segments[1] === "questions") {
    if (segments[2] === "random" && method === "GET") {
      return randomQuestion();
    }

    if (method === "GET") {
      return listQuestions();
    }
    if (method === "POST") {
      return createQuestion(event);
    }
    return json(405, { message: "Method not allowed" });
  }

  if (rawPath.startsWith("/api/score") && method === "POST") {
    return handleScore(event);
  }

  if (segments[0] === "api" && segments[1] === "quiz") {
    const quizId = segments[2];
    switch (method) {
      case "GET":
        return quizId ? getQuiz(quizId) : listQuizzes();
      case "POST":
        return createQuiz(event);
      case "PUT":
      case "PATCH":
        if (!quizId) return json(400, { message: "quiz id is required" });
        return upsertQuiz(event, quizId);
      case "DELETE":
        if (!quizId) return json(400, { message: "quiz id is required" });
        return deleteQuiz(quizId);
      default:
        return json(405, { message: "Method not allowed" });
    }
  }

  return {
    statusCode: 404,
    headers: { "content-type": "text/plain" },
    body: "Not found"
  };
};

async function handleScore(event) {
  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { message: "Invalid JSON" });
  }

  const score = Number(payload.score);
  const total = Number(payload.total);
  if (!Number.isFinite(score) || !Number.isFinite(total)) {
    return json(400, { message: "score and total are required numbers" });
  }

  const sessionRaw = typeof payload.sessionId === "string" ? payload.sessionId : `SESSION#${crypto.randomUUID()}`;
  const sessionId = sessionRaw.startsWith("SESSION#") ? sessionRaw : `SESSION#${sessionRaw}`;
  const ts = Date.now();

  const item = {
    PK: { S: sessionId },
    SK: { S: `TS#${ts}` },
    score: { N: String(score) },
    total: { N: String(total) }
  };

  if (payload.durationMs !== undefined) {
    const duration = Number(payload.durationMs);
    if (Number.isFinite(duration)) {
      item.durationMs = { N: String(duration) };
    }
  }

  if (typeof payload.userId === "string") {
    item.userId = { S: payload.userId };
  }

  await db.send(new PutItemCommand({
    TableName: tableName,
    Item: item
  }));

  return json(200, { ok: true, sessionId });
}

async function listQuestions() {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": { S: "QUESTION" } }
  }));
  const items = (res.Items || []).map(materializeQuestion);
  if (items.length === 0) {
    return json(200, fallbackQuestions);
  }
  return json(200, items);
}

async function randomQuestion() {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": { S: "QUESTION" } }
  }));
  const items = (res.Items || []).map(materializeQuestion);
  const pool = items.length > 0 ? items : fallbackQuestions;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return json(200, pick);
}

async function createQuestion(event) {
  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { message: "Invalid JSON" });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const answer = payload.answer === "aws" || payload.answer === "amazon" ? payload.answer : null;
  const fact = typeof payload.fact === "string" ? payload.fact.trim() : "";
  if (!text || !answer) {
    return json(400, { message: "text and answer(aws|amazon) are required" });
  }

  const id = typeof payload.id === "string" ? payload.id : crypto.randomUUID();
  const now = Date.now();
  const item = {
    PK: { S: "QUESTION" },
    SK: { S: `QUESTION#${id}` },
    id: { S: id },
    text: { S: text },
    answer: { S: answer },
    fact: { S: fact },
    updatedAt: { N: String(now) }
  };

  await db.send(new PutItemCommand({
    TableName: tableName,
    Item: item
  }));

  return json(200, { ok: true, id });
}

async function createQuiz(event) {
  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { message: "Invalid JSON" });
  }

  const id = payload.id && typeof payload.id === "string" ? payload.id : crypto.randomUUID();
  return upsertQuiz({ ...event, body: JSON.stringify({ ...payload, id }) }, id);
}

async function upsertQuiz(event, quizId) {
  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { message: "Invalid JSON" });
  }

  const title = typeof payload.title === "string" ? payload.title : null;
  const qs = Array.isArray(payload.questions) ? payload.questions : null;
  if (!title || !qs) {
    return json(400, { message: "title and questions are required" });
  }

  const now = Date.now();
  const item = {
    PK: { S: "QUIZ" },
    SK: { S: `QUIZ#${quizId}` },
    id: { S: quizId },
    title: { S: title },
    questions: { S: JSON.stringify(qs) },
    updatedAt: { N: String(now) }
  };

  await db.send(new PutItemCommand({
    TableName: tableName,
    Item: item
  }));

  return json(200, { ok: true, id: quizId });
}

async function getQuiz(quizId) {
  const res = await db.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      PK: { S: "QUIZ" },
      SK: { S: `QUIZ#${quizId}` }
    }
  }));

  if (!res.Item) return json(404, { message: "quiz not found" });
  return json(200, materializeQuiz(res.Item));
}

async function listQuizzes() {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": { S: "QUIZ" } }
  }));

  const items = (res.Items || []).map(materializeQuiz);
  return json(200, items);
}

async function deleteQuiz(quizId) {
  await db.send(new DeleteItemCommand({
    TableName: tableName,
    Key: {
      PK: { S: "QUIZ" },
      SK: { S: `QUIZ#${quizId}` }
    }
  }));
  return json(200, { ok: true });
}

function materializeQuiz(item) {
  return {
    id: item.id?.S,
    title: item.title?.S,
    questions: item.questions?.S ? safeParse(item.questions.S, []) : [],
    updatedAt: item.updatedAt?.N ? Number(item.updatedAt.N) : undefined
  };
}

function materializeQuestion(item) {
  return {
    id: item.id?.S,
    text: item.text?.S,
    answer: item.answer?.S,
    fact: item.fact?.S,
    updatedAt: item.updatedAt?.N ? Number(item.updatedAt.N) : undefined
  };
}

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

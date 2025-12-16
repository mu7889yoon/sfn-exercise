const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.TABLE_NAME || 'questions';
const QUESTION_PK = 'QUESTION';
const QUESTION_PREFIX = 'QUESTION#';
const IDEMPOTENCY_PREFIX = 'IDEMPOTENCY#';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const success = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const error = (statusCode, code, message, headers = {}) => success(statusCode, { error: { code, message } }, headers);

const parseJson = (payload) => {
  if (!payload) return undefined;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
};

const withCors = (response, originHeader) => {
  if (!originHeader) return response;
  return {
    ...response,
    headers: {
      ...response.headers,
      'Access-Control-Allow-Origin': originHeader,
      'Access-Control-Allow-Headers': 'Content-Type,If-Match,If-None-Match,Idempotency-Key',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
  };
};

const clamp = (value, min, max, fallback) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
};

const makeDeterministicRng = (seedStr) => {
  let seed = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i += 1) {
    seed = Math.imul(seed ^ seedStr.charCodeAt(i), 3432918353);
    seed = (seed << 13) | (seed >>> 19);
  }
  return () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    seed ^= seed >>> 16;
    return (seed >>> 0) / 0x100000000;
  };
};

const shuffleDeterministic = (items, seed) => {
  const rng = makeDeterministicRng(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const mapItemToQuestion = (item) => ({
  id: item.id,
  slug: item.slug ?? item.id,
  text: item.text,
  answer: item.answer,
  namespace: item.namespace,
  updatedAt: item.updatedAt,
  etag: item.etag,
});

const loadQuestionBank = async () => {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': QUESTION_PK, ':prefix': QUESTION_PREFIX },
      Limit: 200,
    }),
  );
  return (result.Items || []).map(mapItemToQuestion);
};

const buildQuizFromSeed = async (quizId, count = 10, shouldShuffle = true) => {
  const questions = await loadQuestionBank();
  if (questions.length === 0) {
    const err = new Error('NoQuestions');
    err.code = 'NoQuestions';
    throw err;
  }
  const safeCount = clamp(count, 1, 20, 10);
  const seed = quizId || new Date().toISOString();
  const source = shouldShuffle ? shuffleDeterministic(questions, seed) : [...questions];
  const selected = source.slice(0, safeCount);
  return {
    quizId: seed,
    questions: selected,
  };
};

const gradeQuiz = (answers, quizQuestions) => {
  const questionMap = quizQuestions.reduce((acc, q) => acc.set(q.id, q), new Map());
  const results = [];
  let score = 0;

  for (const entry of answers) {
    const target = questionMap.get(entry.questionId);
    if (!target) {
      return { error: `Unknown questionId: ${entry.questionId}` };
    }
    if (!['aws', 'amazon'].includes(entry.choice)) {
      return { error: `Invalid choice for ${entry.questionId}` };
    }
    const correct = target.answer === entry.choice;
    if (correct) score += 1;
    results.push({
      questionId: entry.questionId,
      answer: entry.choice,
      correct,
      correctAnswer: target.answer,
    });
  }

  return {
    score,
    total: quizQuestions.length,
    results,
  };
};

const saveIdempotentResponse = async (key, response) => {
  const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 6; // 6 hours
  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: QUESTION_PK,
        SK: `${IDEMPOTENCY_PREFIX}${key}`,
        response,
        ttl,
      },
    }),
  );
};

const findIdempotentResponse = async (key) => {
  const result = await dynamo.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: QUESTION_PK, SK: `${IDEMPOTENCY_PREFIX}${key}` },
    }),
  );
  return result.Item?.response;
};

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  const quizId = event.pathParameters?.quizId;
  if (!quizId) {
    return withCors(error(400, 'BadRequest', 'quizId is required'), origin);
  }

  const body = parseJson(event.body);
  if (!body || !Array.isArray(body.answers)) {
    return withCors(error(400, 'BadRequest', 'answers array is required'), origin);
  }

  const idempotencyKey = event.headers?.['Idempotency-Key'] || event.headers?.['idempotency-key'];
  if (idempotencyKey) {
    const cached = await findIdempotentResponse(idempotencyKey);
    if (cached) {
      return withCors(cached, origin);
    }
  }

  let quiz;
  try {
    quiz = await buildQuizFromSeed(quizId, undefined, true);
  } catch (err) {
    if (err.code === 'NoQuestions') {
      return withCors(error(404, 'NotFound', 'No questions available. Seed DynamoDB first.'), origin);
    }
    throw err;
  }

  const result = gradeQuiz(body.answers, quiz.questions);
  if (result.error) {
    return withCors(error(400, 'BadRequest', result.error), origin);
  }

  const response = success(200, result);
  if (idempotencyKey) {
    await saveIdempotentResponse(idempotencyKey, response);
  }
  return withCors(response, origin);
};

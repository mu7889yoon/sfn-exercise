const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.TABLE_NAME || 'questions';
const QUESTION_PK = 'QUESTION';
const QUESTION_PREFIX = 'QUESTION#';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const success = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const error = (statusCode, code, message, headers = {}) => success(statusCode, { error: { code, message } }, headers);

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

const sanitizeQuestionForClient = (question) => ({
  id: question.id,
  slug: question.slug,
  text: question.text,
  namespace: question.namespace,
  choices: ['aws', 'amazon'],
});

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  const quizId = event.pathParameters?.quizId;
  if (!quizId) {
    return withCors(error(400, 'BadRequest', 'quizId is required'), origin);
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

  const response = success(200, {
    quizId: quiz.quizId,
    questions: quiz.questions.map(sanitizeQuestionForClient),
    total: quiz.questions.length,
  });
  return withCors(response, origin);
};

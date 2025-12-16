const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

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

const hashEtag = (payload) => crypto.createHash('sha256').update(payload).digest('hex');

const buildQuestionKey = (id) => ({
  PK: QUESTION_PK,
  SK: `${QUESTION_PREFIX}${id}`,
});

const mapItemToQuestion = (item) => ({
  id: item.id,
  slug: item.slug ?? item.id,
  text: item.text,
  answer: item.answer,
  namespace: item.namespace,
  updatedAt: item.updatedAt,
  etag: item.etag,
});

const validateQuestionPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return 'Request body is required';
  if (!payload.id || typeof payload.id !== 'string') return 'id is required';
  if (!payload.text || typeof payload.text !== 'string') return 'text is required';
  if (!['aws', 'amazon'].includes(payload.answer)) return 'answer must be "aws" or "amazon"';
  return undefined;
};

exports.handler = async (event) => {
  const payload = parseJson(event.body);
  const origin = event.headers?.origin || event.headers?.Origin;
  const validation = validateQuestionPayload(payload);
  if (validation) {
    return withCors(error(400, 'BadRequest', validation), origin);
  }

  const updatedAt = Date.now();
  const etag = hashEtag(`${payload.id}:${updatedAt}:${payload.text}:${payload.answer}`);
  const item = {
    ...buildQuestionKey(payload.id),
    id: payload.id,
    slug: payload.slug || payload.id,
    text: payload.text,
    answer: payload.answer,
    namespace: payload.namespace,
    updatedAt,
    etag,
  };

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      return withCors(error(409, 'Conflict', 'Question already exists'), origin);
    }
    throw err;
  }

  const response = success(201, mapItemToQuestion(item), { ETag: etag });
  return withCors(response, origin);
};

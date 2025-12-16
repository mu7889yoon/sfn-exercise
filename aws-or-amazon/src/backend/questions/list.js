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

const decodeCursor = (cursor) => {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    return undefined;
  }
};

const encodeCursor = (key) => {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key)).toString('base64');
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

exports.handler = async (event) => {
  const limitParam = Number(event.queryStringParameters?.limit);
  const limit = clamp(limitParam, 1, 50, 20);
  const cursor = event.queryStringParameters?.cursor;
  const namespace = event.queryStringParameters?.namespace;
  const origin = event.headers?.origin || event.headers?.Origin;

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': QUESTION_PK,
      ':prefix': QUESTION_PREFIX,
    },
    Limit: limit,
    ExclusiveStartKey: decodeCursor(cursor),
  };

  if (namespace) {
    params.FilterExpression = '#ns = :ns';
    params.ExpressionAttributeNames = { '#ns': 'namespace' };
    params.ExpressionAttributeValues[':ns'] = namespace;
  }

  const result = await dynamo.send(new QueryCommand(params));
  const response = success(200, {
    items: (result.Items || []).map(mapItemToQuestion),
    nextCursor: encodeCursor(result.LastEvaluatedKey),
  });
  return withCors(response, origin);
};

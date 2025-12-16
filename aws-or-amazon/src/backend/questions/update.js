const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

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

const fetchQuestionById = async (idOrSlug) => {
  const getResult = await dynamo.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: buildQuestionKey(idOrSlug),
    }),
  );
  if (getResult.Item) return mapItemToQuestion(getResult.Item);

  const listResult = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: '#slug = :slugVal OR #ns = :slugVal',
      ExpressionAttributeNames: { '#slug': 'slug', '#ns': 'namespace' },
      ExpressionAttributeValues: { ':pk': QUESTION_PK, ':prefix': QUESTION_PREFIX, ':slugVal': idOrSlug },
      Limit: 1,
    }),
  );

  if (listResult.Items && listResult.Items.length > 0) {
    return mapItemToQuestion(listResult.Items[0]);
  }
  return undefined;
};

const validateQuestionPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return 'Request body is required';
  if (!payload.text || typeof payload.text !== 'string') return 'text is required';
  if (!['aws', 'amazon'].includes(payload.answer)) return 'answer must be "aws" or "amazon"';
  return undefined;
};

exports.handler = async (event) => {
  const origin = event.headers?.origin || event.headers?.Origin;
  const id = event.pathParameters?.id;
  if (!id) {
    return withCors(error(400, 'BadRequest', 'id is required'), origin);
  }

  const payload = parseJson(event.body);
  const validation = validateQuestionPayload(payload);
  if (validation) {
    return withCors(error(400, 'BadRequest', validation), origin);
  }

  const ifMatch = event.headers?.['If-Match'] || event.headers?.['if-match'];
  if (!ifMatch) {
    return withCors(error(428, 'PreconditionRequired', 'If-Match header is required'), origin);
  }

  const existing = await fetchQuestionById(id);
  if (!existing) {
    return withCors(error(404, 'NotFound', 'Question not found'), origin);
  }
  if (existing.etag && existing.etag !== ifMatch) {
    return withCors(error(412, 'PreconditionFailed', 'ETag does not match'), origin);
  }

  const updatedAt = Date.now();
  const etag = hashEtag(`${id}:${updatedAt}:${payload.text}:${payload.answer}`);

  const item = {
    ...buildQuestionKey(id),
    id,
    slug: payload.slug || id,
    text: payload.text,
    answer: payload.answer,
    namespace: payload.namespace,
    updatedAt,
    etag,
  };

  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    }),
  );

  const response = success(200, mapItemToQuestion(item), { ETag: etag });
  return withCors(response, origin);
};

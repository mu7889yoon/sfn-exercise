const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

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

exports.handler = async (event) => {
  const id = event.pathParameters?.id;
  const origin = event.headers?.origin || event.headers?.Origin;
  if (!id) {
    return withCors(error(400, 'BadRequest', 'id is required'), origin);
  }

  const item = await fetchQuestionById(id);
  if (!item) {
    return withCors(error(404, 'NotFound', 'Question not found'), origin);
  }
  const headers = item.etag ? { ETag: item.etag } : undefined;
  const response = success(200, item, headers);
  return withCors(response, origin);
};

# AWS or Amazon? 〇×クイズ 仕様メモ

## 目的
- AWSのサービス名がAWS ???で始まるか、Amazon ???で始まるかを判定するクイズ
- 静的フロントをS3に置き、CloudFrontで配信。問題配信とスコア保存をLambda経由で提供し、DynamoDBに保存する。

## ユースケース
- 利用者がブラウザでクイズに回答し、結果を即時フィードバック。
- スコア履歴をクライアント側でLocalStorageに保存する。
- 10問1セットとする。

## 機能要件
- クイズ画面
  - 問題文表示と〇(AWS)/×(Amazon)の2択。
  - 回答ごとの正誤表示と補足説明。
  - 進捗/スコア表示、全問終了後のまとめ表示、リスタート。
- API
  - `GET /api/quizzes`：問題一覧を配信（DBが空なら固定問題を返却）
  - `GET /api/quizzes/{id or service namespace or slug}` : 各問題の詳細を表示
  - `POST /api/quizzes/{id or service namespce or slug}`： クライアントの回答を送信し、正誤を判定
  - `GET /api/questions` と CRUD：クイズセットの一覧/取得/作成/更新/削除。

## 非機能要件
- 可用性: CloudFront + S3 で静的部分は高可用。Lambdaはタイムアウト5s程度、再試行なし。
- セキュリティ: S3はパブリックブロック、CloudFront OAC経由のみ。APIはHTTPSのみ。不要なCORSを避け、同一オリジン利用。
- コスト: DynamoDBはオンデマンド(PAY_PER_REQUEST)、Lambdaは軽量(Node.js)でスモールフットプリント。
- IaCにはAWS CDKを採用する。デプロイも`npx cdk deploy`で行う

## アーキテクチャ
- CloudFront
  - オリジン1: S3 (静的サイト)。OACで署名付きアクセス。`DefaultCacheBehavior`。
  - オリジン2: API Gateway。`/api/*`をルーティング。
  - ViewerProtocolPolicy: `redirect-to-https`。
  - キャッシュ: APIは`GET`のみ短期キャッシュ可、`POST`はバイパス。
- S3
  - `index.html`等を格納。パブリックブロック。デプロイは `npx cdk deploy`で行う
- Lambda (サーバーサイドAPI想定、実装タイミングは別途)
  - Node.js 24。環境変数`TABLE_NAME`。
  - 役割: 質問配信/作成、クイズセットCRUD、スコア保存。
  - IAM: DynamoDBへのPut/Query/Delete権限を付与。
- DynamoDB
  - テーブル名: `questions`（例）。
  - 主キー: `PK id or service namespce or slug`で問題の内容を保持  
  - TTL (任意): `ttl` 属性で自動削除を有効化可能。

## API設計案
- 共通
  - Base Path: `/api`。全てJSON、`Content-Type: application/json`、CORSは同一オリジンのみ許可。
  - エラーフォーマット: `{ "error": { "code": "NotFound", "message": "..." } }`。バリデーションエラーは400。
  - IDはURLセーフなスラグとし、作成時はUUIDv4を生成する。`If-None-Match`/`If-Match`で楽観ロック更新を許可。
  - クイズ回答送信は冪等化のため`Idempotency-Key`ヘッダーを受け付け、同一キーは同一レスポンスを返す。
- エンドポイント
  - `GET /api/quizzes`
    - 説明: 10問セットを配信。DynamoDBが空なら固定問題10問を返却。
    - クエリ: `count` (1-20, default 10), `shuffle` (bool, default true)。
    - レスポンス例: `{ "quizId": "2024-aws-01", "questions": [ { "id": "athena", "text": "AthenaはAWS/ Amazon?", "choices": ["aws","amazon"] } ] }`
    - キャッシュ: 60sまでCloudFrontでキャッシュ可。
  - `GET /api/quizzes/{quizId}`
    - 説明: 指定クイズセットの詳細取得（質問リスト）。存在しない場合404。
  - `POST /api/quizzes/{quizId}`
    - 説明: クライアント回答を送信し採点。入力 `{ answers: [{ questionId, choice }] }`。
    - レスポンス: `{ "score": 8, "total": 10, "results": [{ "questionId": "athena", "correct": true, "answer": "aws" }] }`
    - バリデーション: 未知のquestionIdや選択肢は400。タイムアウト5s。
  - `GET /api/questions`
    - 説明: 問題リストのページング取得。クエリ `limit` (1-50, default 20), `cursor` (前回レスポンスの`nextCursor`)、`namespace`/`slug`でフィルタ。
    - レスポンス例: `{ "items": [ { "id": "athena", "text": "...", "answer": "aws" } ], "nextCursor": "eyJza19sYXN0IjoiQkFUI0FUUCIgfQ==" }`
  - `GET /api/questions/{id|namespace|slug}`
    - 説明: 単一問題を取得。
  - `POST /api/questions`
    - 説明: 問題作成。ボディ `{ "id": "athena", "text": "...", "answer": "aws", "namespace": "analytics" }`
    - レスポンス: 作成した問題。`201 Created`。
  - `PUT /api/questions/{id|namespace|slug}`
    - 説明: 全更新。If-MatchヘッダーでETag必須。
  - `DELETE /api/questions/{id|namespace|slug}`
    - 説明: 論理削除で`ttl`を設定し、自動削除を待つ。`204 No Content`。

## DynamoDBテーブル構造案
- `questions`
  - PartitionKey: 固定で `PK = "QUESTION"`
  - SortKey: `SK = "QUESTION#<questionId>"`
  - 属性例: `id` (string), `text` (string), `answer` ("aws"|"amazon"), `updatedAt` (number)

## Lambda ハンドラー挙動 (例)
- `GET /api/questions` / `GET /api/questions/random`: DynamoDBのQUESTION項目を返却（空なら固定問題）。
- `POST /api/questions`: 問題を作成/追加。
- `POST /api/score`: JSONをパースし、UUID付与(`sessionId`無い場合)。`PutItem`で保存し、ステータス200を返却。
- `GET|POST|PUT|DELETE /api/quiz[...]`: クイズセットのCRUDを実装。

## デプロイ/運用フロー (例)
1. デプロイ手段（CDK）に合わせて実装する。

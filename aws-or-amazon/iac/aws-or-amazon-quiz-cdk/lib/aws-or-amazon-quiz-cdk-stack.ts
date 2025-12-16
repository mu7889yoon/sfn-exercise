import { join } from 'node:path';
import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';

export class AwsOrAmazonQuizCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const questionsTable = new dynamodb.Table(this, 'QuestionsTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_24_X,
      code: lambda.Code.fromAsset(join(__dirname, '..', '..', '..', 'src', 'backend')),
      environment: { TABLE_NAME: questionsTable.tableName },
      memorySize: 256,
      timeout: Duration.seconds(10),
    };

    const quizRandomFn = new lambda.Function(this, 'QuizRandomFn', {
      ...lambdaDefaults,
      handler: 'quizzes/random.handler',
      description: 'Return random quiz set',
    });
    const quizIdsFn = new lambda.Function(this, 'QuizIdsFn', {
      ...lambdaDefaults,
      handler: 'quizzes/ids.handler',
      description: 'Return random quiz ids only',
    });
    const quizGetFn = new lambda.Function(this, 'QuizGetFn', {
      ...lambdaDefaults,
      handler: 'quizzes/get.handler',
      description: 'Return quiz set by seed/quizId',
    });
    const quizAnswerFn = new lambda.Function(this, 'QuizAnswerFn', {
      ...lambdaDefaults,
      handler: 'quizzes/answer.handler',
      description: 'Grade quiz answers',
    });

    const questionListFn = new lambda.Function(this, 'QuestionListFn', {
      ...lambdaDefaults,
      handler: 'questions/list.handler',
      description: 'List questions',
    });
    const questionGetFn = new lambda.Function(this, 'QuestionGetFn', {
      ...lambdaDefaults,
      handler: 'questions/get.handler',
      description: 'Get question detail',
    });
    const questionCreateFn = new lambda.Function(this, 'QuestionCreateFn', {
      ...lambdaDefaults,
      handler: 'questions/create.handler',
      description: 'Create question',
    });
    const questionUpdateFn = new lambda.Function(this, 'QuestionUpdateFn', {
      ...lambdaDefaults,
      handler: 'questions/update.handler',
      description: 'Update question',
    });
    const questionDeleteFn = new lambda.Function(this, 'QuestionDeleteFn', {
      ...lambdaDefaults,
      handler: 'questions/delete.handler',
      description: 'Delete question (TTL mark)',
    });

    [
      quizRandomFn,
      quizGetFn,
      quizAnswerFn,
      quizIdsFn,
      questionListFn,
      questionGetFn,
      questionCreateFn,
      questionUpdateFn,
      questionDeleteFn,
    ].forEach((fn) => questionsTable.grantReadWriteData(fn));

    const restApi = new apigateway.RestApi(this, 'QuizApi', {
      restApiName: 'AwsOrAmazonQuizApi',
      deployOptions: {
        stageName: 'prod',
        cachingEnabled: false,
        metricsEnabled: true,
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
    });

    const apiRoot = restApi.root.addResource('api');
    const quizzes = apiRoot.addResource('quizzes');
    const quizId = quizzes.addResource('{quizId}');
    const quizIds = quizzes.addResource('ids');
    quizzes.addMethod('GET', new apigateway.LambdaIntegration(quizRandomFn));
    quizIds.addMethod('GET', new apigateway.LambdaIntegration(quizIdsFn));
    quizId.addMethod('GET', new apigateway.LambdaIntegration(quizGetFn));
    quizId.addMethod('POST', new apigateway.LambdaIntegration(quizAnswerFn));

    const questions = apiRoot.addResource('questions');
    const questionId = questions.addResource('{id}');
    questions.addMethod('GET', new apigateway.LambdaIntegration(questionListFn));
    questions.addMethod('POST', new apigateway.LambdaIntegration(questionCreateFn));
    questionId.addMethod('GET', new apigateway.LambdaIntegration(questionGetFn));
    questionId.addMethod('PUT', new apigateway.LambdaIntegration(questionUpdateFn));
    questionId.addMethod('DELETE', new apigateway.LambdaIntegration(questionDeleteFn));

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const siteDeployment = new s3deploy.BucketDeployment(this, 'DeployStaticSite', {
      destinationBucket: siteBucket,
      sources: [s3deploy.Source.asset(join(__dirname, '..', '..', '..', 'src', 'frontend'))],
    });

    const originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'SiteOAC', {
      originAccessControlConfig: {
        name: `${Stack.of(this).stackName}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'Origin access control for the static site bucket',
      },
    });

    const apiCachePolicy = new cloudfront.CachePolicy(this, 'ApiCachePolicy', {
      defaultTtl: Duration.seconds(60),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.minutes(5),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'Content-Type',
        'If-None-Match',
        'If-Match',
        'Idempotency-Key',
        'Origin',
      ),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
    });

    const apiDomain = restApi.url.replace('https://', '').split('/')[0];
    const apiPath = `/${restApi.deploymentStage.stageName}`;
    const staticCache = cloudfront.CachePolicy.CACHING_OPTIMIZED;
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      comment: 'Forward required headers and all query strings to API Gateway (without Host)',
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'Content-Type',
        'If-None-Match',
        'If-Match',
        'Idempotency-Key',
        'Origin',
      ),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });

    const distribution = new cloudfront.CfnDistribution(this, 'Distribution', {
      distributionConfig: {
        enabled: true,
        defaultRootObject: 'index.html',
        httpVersion: 'http2and3',
        priceClass: 'PriceClass_100',
        origins: [
          {
            id: 'S3Origin',
            domainName: siteBucket.bucketRegionalDomainName,
            s3OriginConfig: {},
            originAccessControlId: originAccessControl.attrId,
          },
          {
            id: 'ApiOrigin',
            domainName: apiDomain,
            originPath: apiPath,
            customOriginConfig: {
              originProtocolPolicy: 'https-only',
              originSslProtocols: ['TLSv1.2'],
            },
          },
        ],
        defaultCacheBehavior: {
          targetOriginId: 'S3Origin',
          viewerProtocolPolicy: 'redirect-to-https',
          compress: true,
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD'],
          cachePolicyId: staticCache.cachePolicyId,
        },
        cacheBehaviors: [
          {
            pathPattern: '/api/*',
            targetOriginId: 'ApiOrigin',
            viewerProtocolPolicy: 'redirect-to-https',
            compress: true,
            allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
            cachedMethods: ['GET', 'HEAD'],
            cachePolicyId: apiCachePolicy.cachePolicyId,
            originRequestPolicyId: apiOriginRequestPolicy.originRequestPolicyId,
          },
        ],
        viewerCertificate: {
          cloudFrontDefaultCertificate: true,
        },
      },
    });

    siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [siteBucket.arnForObjects('*')],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.attrId}`,
          },
        },
      }),
    );

    const invalidateCache = new cr.AwsCustomResource(this, 'InvalidateCloudFrontCache', {
      onCreate: {
        service: 'CloudFront',
        action: 'createInvalidation',
        parameters: {
          DistributionId: distribution.attrId,
          InvalidationBatch: {
            CallerReference: `deploy-${Date.now()}`,
            Paths: { Quantity: 1, Items: ['/*'] },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`invalidate-${Date.now()}`),
      },
      onUpdate: {
        service: 'CloudFront',
        action: 'createInvalidation',
        parameters: {
          DistributionId: distribution.attrId,
          InvalidationBatch: {
            CallerReference: `deploy-update-${Date.now()}`,
            Paths: { Quantity: 1, Items: ['/*'] },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`invalidate-${Date.now()}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });
    invalidateCache.node.addDependency(siteDeployment);

    new CfnOutput(this, 'DistributionDomain', { value: distribution.attrDomainName });
    new CfnOutput(this, 'ApiEndpoint', { value: `${restApi.url}api/` });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'QuestionsTableName', { value: questionsTable.tableName });
  }
}

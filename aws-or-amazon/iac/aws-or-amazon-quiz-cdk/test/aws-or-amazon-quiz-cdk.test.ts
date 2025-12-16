import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsOrAmazonQuizCdkStack } from '../lib/aws-or-amazon-quiz-cdk-stack';

describe('AwsOrAmazonQuizCdkStack', () => {
  test('creates storage, api, and distribution pieces', () => {
    const app = new App();
    const stack = new AwsOrAmazonQuizCdkStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    });

    template.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        Handler: 'handler.main',
        Runtime: 'nodejs24.x',
        Environment: {
          Variables: {
            TABLE_NAME: Match.anyValue(),
          },
        },
      }),
    );

    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });

    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  });
});

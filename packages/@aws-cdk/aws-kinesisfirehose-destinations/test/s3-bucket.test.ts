import '@aws-cdk/assert-internal/jest';
import { ABSENT, Capture, anything, MatchStyle, arrayWith } from '@aws-cdk/assert-internal';
import * as iam from '@aws-cdk/aws-iam';
import * as firehose from '@aws-cdk/aws-kinesisfirehose';
import * as kms from '@aws-cdk/aws-kms';
import * as logs from '@aws-cdk/aws-logs';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import * as firehosedestinations from '../lib';

describe('S3 destination', () => {
  let stack: cdk.Stack;
  let bucket: s3.IBucket;
  let destinationRole: iam.IRole;

  beforeEach(() => {
    stack = new cdk.Stack();
    bucket = new s3.Bucket(stack, 'Bucket');
    destinationRole = new iam.Role(stack, 'Destination Role', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
  });

  it('provides defaults when no configuration is provided', () => {
    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket, { role: destinationRole })],
    });

    expect(stack).toHaveResource('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: {
        BucketARN: stack.resolve(bucket.bucketArn),
        CloudWatchLoggingOptions: {
          Enabled: true,
          LogGroupName: anything(),
          LogStreamName: anything(),
        },
        EncryptionConfiguration: {
          NoEncryptionConfig: 'NoEncryption',
        },
        RoleARN: stack.resolve(destinationRole.roleArn),
      },
    });
    expect(stack).toHaveResource('AWS::Logs::LogGroup');
    expect(stack).toHaveResource('AWS::Logs::LogStream');
  });

  it('allows disabling logging', () => {
    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket, {
        logging: false,
      })],
    });

    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: {
        CloudWatchLoggingOptions: ABSENT,
      },
    });
  });

  it('allows providing a log group', () => {
    const logGroup = logs.LogGroup.fromLogGroupName(stack, 'Log Group', 'evergreen');

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket, {
        logGroup,
      })],
    });

    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: {
        CloudWatchLoggingOptions: {
          LogGroupName: 'evergreen',
        },
      },
    });
  });

  it('creates a role when none is provided', () => {
    const capturedRoleArn = Capture.aString();

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket)],
    });

    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      ExtendedS3DestinationConfiguration: {
        RoleARN: {
          'Fn::GetAtt': [
            capturedRoleArn.capture(),
            'Arn',
          ],
        },
      },
    });
    expect(stack).toMatchTemplate({
      [capturedRoleArn.capturedValue]: {
        Type: 'AWS::IAM::Role',
      },
    }, MatchStyle.SUPERSET);
  });

  it('grants encrypt/decrypt access to the destination encryptionKey', () => {
    const key = new kms.Key(stack, 'Key');

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [new firehosedestinations.S3Bucket(bucket, {
        encryptionKey: key,
        role: destinationRole,
      })],
    });

    expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
      Roles: [stack.resolve(destinationRole.roleName)],
      PolicyDocument: {
        Statement: arrayWith({
          Action: [
            'kms:Decrypt',
            'kms:Encrypt',
            'kms:ReEncrypt*',
            'kms:GenerateDataKey*',
          ],
          Effect: 'Allow',
          Resource: stack.resolve(key.keyArn),
        }),
      },
    });
  });

  it('grants read/write access to the bucket', () => {
    const destination = new firehosedestinations.S3Bucket(bucket, { role: destinationRole });

    new firehose.DeliveryStream(stack, 'DeliveryStream', {
      destinations: [destination],
    });

    expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
      Roles: [stack.resolve(destinationRole.roleName)],
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetObject*',
              's3:GetBucket*',
              's3:List*',
              's3:DeleteObject*',
              's3:PutObject*',
              's3:Abort*',
            ],
            Effect: 'Allow',
            Resource: [
              stack.resolve(bucket.bucketArn),
              {
                'Fn::Join': [
                  '',
                  [
                    stack.resolve(bucket.bucketArn),
                    '/*',
                  ],
                ],
              },
            ],
          },
        ],
      },
    });
  });
});

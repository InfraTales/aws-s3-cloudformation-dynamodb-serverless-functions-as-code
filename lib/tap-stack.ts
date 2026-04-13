/**
 * ═══════════════════════════════════════════════════════════════════════════
 *                              INFRATALES™
 *              Production-Ready AWS Infrastructure Solutions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @project     aws-s3-cloudformation-dynamodb-serverless-functions-as-code
 * @file        tap-stack.ts
 * @author      Rahul Ladumor <rahul.ladumor@infratales.com>
 * @copyright   Copyright (c) 2024-2026 Rahul Ladumor / InfraTales
 * @license     InfraTales Open Source License (see LICENSE file)
 *
 * @website     https://infratales.com
 * @github      https://github.com/InfraTales
 * @portfolio   https://www.rahulladumor.in
 *
 * ───────────────────────────────────────────────────────────────────────────
 * This file is part of InfraTales open-source infrastructure projects.
 * Unauthorized removal of this header violates the license terms.
 *
 * SIGNATURE: INFRATALES-77F971722E50
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as kinesisfirehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as kinesisanalytics from 'aws-cdk-lib/aws-kinesisanalytics';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

interface TapStackProps extends cdk.StackProps {
  environmentSuffix?: string;
}

export class TapStack extends cdk.Stack {
  // Public properties for testing
  public readonly encryptionKey: kms.Key;
  public readonly dataLakeBucket: s3.Bucket;
  public readonly kinesisStream: kinesis.Stream;
  public readonly dynamoTable: dynamodb.Table;
  public readonly opensearchDomain: opensearch.Domain;
  public readonly alertTopic: sns.Topic;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly ingestLambda: lambda.Function;
  public readonly processorLambda: lambda.Function;
  public readonly api: apigateway.RestApi;
  public readonly environmentSuffix: string;

  constructor(scope: Construct, id: string, props?: TapStackProps) {
    super(scope, id, props);

    // Get environment suffix from props, context, or use 'dev' as default
    this.environmentSuffix =
      props?.environmentSuffix ||
      this.node.tryGetContext('environmentSuffix') ||
      'dev';

    // Create encryption key for all services
    this.encryptionKey = this.createEncryptionKey(this.environmentSuffix);

    // Create S3 data lake bucket
    this.dataLakeBucket = this.createDataLakeBucket(this.environmentSuffix);

    // Create Kinesis Data Stream for real-time ingestion
    this.kinesisStream = this.createKinesisStream(this.environmentSuffix);

    // Create DynamoDB table for analytics results
    this.dynamoTable = this.createDynamoTable(this.environmentSuffix);

    // Create OpenSearch domain for search and analytics
    this.opensearchDomain = this.createOpenSearchDomain(this.environmentSuffix);

    // Create SNS/SQS for alerting and dead letter queue
    const messaging = this.createMessagingInfrastructure(
      this.environmentSuffix
    );
    this.alertTopic = messaging.topic;
    this.deadLetterQueue = messaging.dlq;

    // Create Lambda functions for processing
    const lambdaFunctions = this.createLambdaFunctions(this.environmentSuffix);
    this.ingestLambda = lambdaFunctions.ingestLambda;
    this.processorLambda = lambdaFunctions.processorLambda;

    // Create API Gateway for data ingestion
    this.api = this.createApiGateway(this.ingestLambda, this.environmentSuffix);

    // Create Kinesis Data Firehose for batch processing
    this.createKinesisFirehose(this.environmentSuffix);

    // Create Glue catalog and crawler
    this.createGlueInfrastructure(this.environmentSuffix);

    // Create Athena workgroup for queries
    this.createAthenaWorkgroup(this.environmentSuffix);

    // Create Kinesis Analytics application
    this.createKinesisAnalytics(this.environmentSuffix);

    // Set up CloudWatch dashboards and alarms
    this.createMonitoringInfrastructure(this.environmentSuffix);

    // Output important resource ARNs
    this.createOutputs();
  }

  private createEncryptionKey(environmentSuffix: string): kms.Key {
    return new kms.Key(this, 'DataEncryptionKey', {
      description: `KMS key for encrypting data at rest - ${environmentSuffix}`,
      enableKeyRotation: true,
      alias: `alias/analytics-${environmentSuffix}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createDataLakeBucket(environmentSuffix: string): s3.Bucket {
    return new s3.Bucket(this, 'DataLakeBucket', {
      bucketName: `analytics-data-lake-${this.account}-${this.region}-${environmentSuffix}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'archive-old-data',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createKinesisStream(environmentSuffix: string): kinesis.Stream {
    return new kinesis.Stream(this, 'DataStream', {
      streamName: `analytics-stream-${environmentSuffix}`,
      shardCount: 2,
      retentionPeriod: cdk.Duration.days(1),
      encryption: kinesis.StreamEncryption.KMS,
      encryptionKey: this.encryptionKey,
      streamMode: kinesis.StreamMode.PROVISIONED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createDynamoTable(environmentSuffix: string): dynamodb.Table {
    return new dynamodb.Table(this, 'AnalyticsTable', {
      tableName: `analytics-results-${environmentSuffix}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createOpenSearchDomain(environmentSuffix: string): opensearch.Domain {
    return new opensearch.Domain(this, 'SearchDomain', {
      domainName: `analytics-search-${environmentSuffix}`,
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: 't3.medium.search', // Increased from t3.small for better performance
        multiAzWithStandbyEnabled: false, // Keep false for dev environment
      },
      ebs: {
        volumeSize: 20, // Increased from 10GB
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
      },
      enforceHttps: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private createMessagingInfrastructure(environmentSuffix: string): {
    topic: sns.Topic;
    dlq: sqs.Queue;
  } {
    // Dead letter queue for failed messages
    const dlq = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `analytics-dlq-${environmentSuffix}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Alert topic for notifications
    const topic = new sns.Topic(this, 'AlertTopic', {
      topicName: `analytics-alerts-${environmentSuffix}`,
      masterKey: this.encryptionKey,
    });

    // Processing queue with DLQ (removed SNS subscription to avoid circular dependency)
    new sqs.Queue(this, 'ProcessingQueue', {
      queueName: `analytics-processing-${environmentSuffix}`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey,
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    return { topic, dlq };
  }

  private createLambdaFunctions(environmentSuffix: string): {
    ingestLambda: lambda.Function;
    processorLambda: lambda.Function;
  } {
    // Common Lambda configuration (simplified to avoid circular dependencies)
    const commonConfig = {
      runtime: lambda.Runtime.NODEJS_20_X,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        ENVIRONMENT_SUFFIX: environmentSuffix,
        OPENSEARCH_ENDPOINT: this.opensearchDomain.domainEndpoint,
      },
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
    };

    // Data ingestion Lambda
    const ingestLambda = new lambda.Function(this, 'IngestFunction', {
      ...commonConfig,
      functionName: `data-ingestion-${environmentSuffix}`,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          const AWS = require('aws-sdk');
          const kinesis = new AWS.Kinesis();

          const data = JSON.parse(event.body || '{}');
          const streamName = 'analytics-stream-' + process.env.ENVIRONMENT_SUFFIX;
          const record = {
            StreamName: streamName,
            Data: JSON.stringify(data),
            PartitionKey: data.id || Date.now().toString(),
          };

          await kinesis.putRecord(record).promise();
          return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Data ingested' })
          };
        };
      `),
      handler: 'index.handler',
    });

    // Stream processor Lambda
    const processorLambda = new lambda.Function(this, 'ProcessorFunction', {
      ...commonConfig,
      functionName: `stream-processor-${environmentSuffix}`,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          const AWS = require('aws-sdk');
          const dynamodb = new AWS.DynamoDB.DocumentClient();
          const sns = new AWS.SNS();

          const envSuffix = process.env.ENVIRONMENT_SUFFIX;
          const tableName = 'analytics-results-' + envSuffix;
          const topicArn = 'arn:aws:sns:us-east-1:XXXXXXXXXXXX:analytics-alerts-' + envSuffix;

          for (const record of event.Records) {
            const data = JSON.parse(Buffer.from(record.kinesis.data, 'base64').toString());

            // Store in DynamoDB
            await dynamodb.put({
              TableName: tableName,
              Item: {
                pk: 'DATA#' + data.id,
                sk: 'TIMESTAMP#' + Date.now(),
                data: JSON.stringify(data),
                ttl: Math.floor(Date.now() / 1000) + 86400,
              },
            }).promise();

            // Check for anomalies and alert
            if (data.value && data.value > 1000) {
              await sns.publish({
                TopicArn: topicArn,
                Message: JSON.stringify(data),
                Subject: 'Anomaly Detected',
              }).promise();
            }
          }
          return { statusCode: 200 };
        };
      `),
      handler: 'index.handler',
    });

    // Grant permissions via inline policies to avoid circular dependencies
    ingestLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kinesis:PutRecord', 'kinesis:PutRecords'],
        resources: [this.kinesisStream.streamArn],
      })
    );

    processorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kinesis:DescribeStream',
          'kinesis:GetShardIterator',
          'kinesis:ListShards',
          'kinesis:GetRecords',
          'kinesis:ListStreams',
        ],
        resources: [this.kinesisStream.streamArn],
      })
    );

    processorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:GetItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: [this.dynamoTable.tableArn],
      })
    );

    processorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: [this.alertTopic.topicArn],
      })
    );

    // Add Kinesis event source to processor
    processorLambda.addEventSource(
      new KinesisEventSource(this.kinesisStream, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: cdk.Duration.seconds(5),
        retryAttempts: 3,
      })
    );

    return { ingestLambda, processorLambda };
  }

  private createApiGateway(
    ingestLambda: lambda.Function,
    environmentSuffix: string
  ): apigateway.RestApi {
    const api = new apigateway.RestApi(this, 'DataIngestionApi', {
      restApiName: `analytics-api-${environmentSuffix}`,
      description: 'API for real-time data ingestion',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        dataTraceEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        throttlingBurstLimit: 1000,
        throttlingRateLimit: 500,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Create /ingest endpoint
    const ingestResource = api.root.addResource('ingest');
    ingestResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(ingestLambda)
    );

    return api;
  }

  private createKinesisFirehose(environmentSuffix: string): void {
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      inlinePolicies: {
        FirehosePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kinesis:DescribeStream',
                'kinesis:GetShardIterator',
                'kinesis:ListShards',
                'kinesis:GetRecords',
                'kinesis:ListStreams',
              ],
              resources: [this.kinesisStream.streamArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:AbortMultipartUpload',
                's3:GetBucketLocation',
                's3:GetObject',
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:PutObject',
                's3:PutObjectAcl', // Added for Firehose S3 destination
              ],
              resources: [
                this.dataLakeBucket.bucketArn,
                `${this.dataLakeBucket.bucketArn}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['logs:PutLogEvents'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    new kinesisfirehose.CfnDeliveryStream(this, 'DataFirehose', {
      deliveryStreamName: `analytics-firehose-${environmentSuffix}`,
      deliveryStreamType: 'KinesisStreamAsSource',
      kinesisStreamSourceConfiguration: {
        kinesisStreamArn: this.kinesisStream.streamArn,
        roleArn: firehoseRole.roleArn,
      },
      extendedS3DestinationConfiguration: {
        bucketArn: this.dataLakeBucket.bucketArn,
        prefix:
          'raw-data/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix: 'errors/',
        roleArn: firehoseRole.roleArn,
        compressionFormat: 'GZIP',
        bufferingHints: {
          sizeInMBs: 5,
          intervalInSeconds: 60,
        },
      },
    });
  }

  private createGlueInfrastructure(environmentSuffix: string): void {
    const glueRole = new iam.Role(this, 'GlueRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSGlueServiceRole'
        ),
      ],
      inlinePolicies: {
        GlueS3Policy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                this.dataLakeBucket.bucketArn,
                `${this.dataLakeBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
      },
    });

    const database = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: `analytics_catalog_${environmentSuffix}`,
        description: 'Data catalog for real-time analytics',
      },
    });

    new glue.CfnCrawler(this, 'GlueCrawler', {
      name: `analytics-crawler-${environmentSuffix}`,
      role: glueRole.roleArn,
      databaseName: database.ref,
      targets: {
        s3Targets: [
          {
            path: `s3://${this.dataLakeBucket.bucketName}/raw-data/`,
          },
        ],
      },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
    });
  }

  private createAthenaWorkgroup(environmentSuffix: string): void {
    const athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      bucketName: `analytics-athena-results-${this.account}-${this.region}-${environmentSuffix}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      lifecycleRules: [
        {
          id: 'cleanup-old-results',
          expiration: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new athena.CfnWorkGroup(this, 'AthenaWorkgroup', {
      name: `analytics-workgroup-${environmentSuffix}`,
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_KMS',
            kmsKey: this.encryptionKey.keyArn,
          },
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
      },
    });
  }

  private createKinesisAnalytics(environmentSuffix: string): void {
    const analyticsRole = new iam.Role(this, 'AnalyticsRole', {
      assumedBy: new iam.ServicePrincipal('kinesisanalytics.amazonaws.com'),
      inlinePolicies: {
        AnalyticsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kinesis:DescribeStream',
                'kinesis:GetShardIterator',
                'kinesis:ListShards',
                'kinesis:GetRecords',
                'kinesis:ListStreams',
              ],
              resources: [this.kinesisStream.streamArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:GetItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [this.dynamoTable.tableArn],
            }),
          ],
        }),
      },
    });

    // SQL-based Kinesis Analytics (much simpler than Flink)
    new kinesisanalytics.CfnApplicationV2(this, 'StreamingAnalytics', {
      applicationName: `analytics-sql-app-${environmentSuffix}`,
      runtimeEnvironment: 'SQL-1_0', // ✅ Simpler SQL runtime
      serviceExecutionRole: analyticsRole.roleArn,
      applicationConfiguration: {
        sqlApplicationConfiguration: {
          inputs: [
            {
              namePrefix: 'SOURCE',
              kinesisStreamsInput: {
                resourceArn: this.kinesisStream.streamArn,
              },
              inputSchema: {
                recordColumns: [
                  { name: 'id', sqlType: 'VARCHAR(64)', mapping: '$.id' },
                  {
                    name: 'metric_value',
                    sqlType: 'DOUBLE',
                    mapping: '$.value',
                  },
                  {
                    name: 'event_time',
                    sqlType: 'BIGINT',
                    mapping: '$.timestamp',
                  },
                ],
                recordFormat: {
                  recordFormatType: 'JSON',
                  mappingParameters: {
                    jsonMappingParameters: { recordRowPath: '$' },
                  },
                },
              },
            },
          ],
        },
        applicationCodeConfiguration: {
          codeContent: {
            textContent: `
              CREATE OR REPLACE STREAM "DEST_STREAM" (
                id VARCHAR(64),
                avg_value DOUBLE
              );

              CREATE OR REPLACE PUMP "STREAM_PUMP" AS
              INSERT INTO "DEST_STREAM"
              SELECT STREAM id, AVG(metric_value) AS avg_value
              FROM SOURCE_STREAM
              GROUP BY id, STEP("INTERVAL" BY 1 MINUTE);
            `,
          },
          codeContentType: 'PLAINTEXT',
        },
      },
    });
  }

  private createMonitoringInfrastructure(environmentSuffix: string): void {
    // Create CloudWatch dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'AnalyticsDashboard', {
      dashboardName: `analytics-${environmentSuffix}`,
      defaultInterval: cdk.Duration.hours(1),
    });

    // Add Lambda metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Performance',
        left: [
          this.ingestLambda.metricInvocations(),
          this.processorLambda.metricInvocations(),
        ],
        right: [
          this.ingestLambda.metricErrors(),
          this.processorLambda.metricErrors(),
        ],
      })
    );

    // Create alarms (removed SNS action to avoid circular dependency)
    new cloudwatch.Alarm(this, 'HighErrorRate', {
      metric: this.processorLambda.metricErrors(),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'High error rate in stream processor',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'ApiEndpointOutput', {
      value: this.api.url,
      description: 'API Gateway endpoint for data ingestion',
      exportName: `AnalyticsApiEndpoint-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'KinesisStreamArnOutput', {
      value: this.kinesisStream.streamArn,
      description: 'Kinesis Data Stream ARN',
      exportName: `AnalyticsStreamArn-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'DataLakeBucketOutput', {
      value: this.dataLakeBucket.bucketName,
      description: 'S3 Data Lake bucket name',
      exportName: `DataLakeBucketName-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'DynamoTableNameOutput', {
      value: this.dynamoTable.tableName,
      description: 'DynamoDB table for analytics results',
      exportName: `AnalyticsTableName-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'OpenSearchEndpointOutput', {
      value: this.opensearchDomain.domainEndpoint,
      description: 'OpenSearch domain endpoint',
      exportName: `OpenSearchEndpoint-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'IngestLambdaArnOutput', {
      value: this.ingestLambda.functionArn,
      description: 'Data ingestion Lambda function ARN',
      exportName: `IngestLambdaArn-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'ProcessorLambdaArnOutput', {
      value: this.processorLambda.functionArn,
      description: 'Stream processor Lambda function ARN',
      exportName: `ProcessorLambdaArn-${this.stackName}`,
    });

    new cdk.CfnOutput(this, 'EnvironmentSuffixOutput', {
      value: this.environmentSuffix,
      description: 'Environment suffix used for resource naming',
      exportName: `EnvironmentSuffix-${this.stackName}`,
    });
  }
}

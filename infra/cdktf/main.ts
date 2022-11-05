import * as path from 'path';
import { Construct } from 'constructs';
import { App, TerraformStack, TerraformOutput, TerraformAsset, AssetType, TerraformVariable } from 'cdktf';
import { RandomProvider } from '@cdktf/provider-random/lib/provider';
import { Id } from '@cdktf/provider-random/lib/id';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { CodecommitRepository } from '@cdktf/provider-aws/lib/codecommit-repository';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { LambdaInvocation } from '@cdktf/provider-aws/lib/lambda-invocation';
import { IamRole, IamRoleInlinePolicy } from '@cdktf/provider-aws/lib/iam-role';
import { SfnStateMachine } from '@cdktf/provider-aws/lib/sfn-state-machine';
import { CloudwatchEventRule } from '@cdktf/provider-aws/lib/cloudwatch-event-rule';
import { CloudwatchEventTarget } from '@cdktf/provider-aws/lib/cloudwatch-event-target';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { S3BucketNotification } from '@cdktf/provider-aws/lib/s3-bucket-notification';
import { LambdaFunction, LambdaFunctionEnvironment } from '@cdktf/provider-aws/lib/lambda-function';
import { S3BucketObject } from '@cdktf/provider-aws/lib/s3-bucket-object';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';

interface LambdaFunctionConfig {
  path: string;
  handler: string;
  runtime: string;
  version: string;
}

interface S3AssetConfig {
  path: string;
  version: string;
}

interface AutomatedIamAccessAnalyzerConfig {
  repo: {
    allowFile: S3AssetConfig;
    denyFile: S3AssetConfig;
  };
  lambdas: {
    provideContext: LambdaFunctionConfig;
    pushPoliciesToRepositoryConfig: LambdaFunctionConfig;
    initializeRepositoryConfig: LambdaFunctionConfig;
  };
}

const lambdaRolePolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Principal: {
        Service: 'lambda.amazonaws.com',
      },
      Effect: 'Allow',
      Sid: '',
    },
  ],
};

const sfnRolePolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: {
        Service: 'states.amazonaws.com',
      },
      Action: 'sts:AssumeRole',
    },
  ],
};

class AutomatedIamAccessAnalyzerStack extends TerraformStack {
  constructor(scope: Construct, name: string, config: AutomatedIamAccessAnalyzerConfig) {
    super(scope, name);

    const accountId = new TerraformVariable(this, 'accountId', {
      type: 'string',
      description: 'The AWS account id to which the stack is to be deployed',
    });

    const region = new TerraformVariable(this, 'region', {
      type: 'string',
      description: 'The AWS region to which the stack is to be deployed',
    });

    const sched = new TerraformVariable(this, 'schedule', {
      type: 'string',
      description: 'The schedule to trigger the Automated IAM Access Analyzer',
      default: 'cron(0 18 ? * MON-FRI *)',
    });

    const trailLookBackDays = new TerraformVariable(this, 'trailLookBack', {
      type: 'number',
      description: 'The number of days of history to analyze the specified trail',
      default: 90,
    });

    const roleArns = new TerraformVariable(this, 'roleArns', {
      type: 'string',
      description: 'A list of role arns',
    });

    const trailArn = new TerraformVariable(this, 'trailArn', {
      type: 'string',
      description: 'The Amazon CloudTrail trail to work with when monitoring permission usage',
    });

    new AwsProvider(this, 'aws', {
      region: region.stringValue,
    });

    new RandomProvider(this, 'random', {});

    const repoId = new Id(this, 'policy-repo-id', {
      byteLength: 8,
    });

    const mainBranchName = 'main';

    const repo = new CodecommitRepository(this, 'policy-repo', {
      repositoryName: `aiaa-policy-repo-${repoId.hex}`,
      defaultBranch: mainBranchName,
      description: 'A repository for polished policies in the Automated IAM ',
    });

    const resourcesBucketSuffix = new Id(this, 'resources-bucket-suffix', {
      byteLength: 8,
    });

    const resourcesBucket = new S3Bucket(this, 'resources', {
      bucket: `aiaa-resources-${resourcesBucketSuffix.hex}`,
    });

    const dataBucketSuffix = new Id(this, 'data-bucket-suffix', {
      byteLength: 8,
    });

    const dataBucket = new S3Bucket(this, 'data-bucket', {
      bucket: `aiaa-data-${dataBucketSuffix.hex}`,
      versioning: {
        enabled: true,
      },
    });

    const pushPoliciesToRepoFunc = this.setupLambda(this, 'aiaa-push-policies-to-repo', {
      lambda: config.lambdas.pushPoliciesToRepositoryConfig,
      bucket: resourcesBucket.bucket,
      environment: {
        variables: {
          CODECOMMIT_REPO_NAME: repo.repositoryName,
          CODECOMMIT_TARGET_BRANCH_NAME: mainBranchName,
          CODECOMMIT_REPO_FOLDER_PATH: '/',
        },
      },
      inlinePolicy: [
        {
          name: 'PolicyRepoAccess',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['codecommit:GetBranch', 'codecommit:CreateCommit', 'codecommit:GetFile', 'codecommit:PutFile'],
                Resource: repo.arn,
              },
            ],
          }),
        },
        {
          name: 'DataBucketAccess',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:GetObject*', 's3:GetBucket*', 's3:List*'],
                Resource: [dataBucket.arn, `${dataBucket.arn}/*`],
              },
            ],
          }),
        },
      ],
    });

    const allowFileObject = this.pushS3Object(this, 'allowFile', {
      assetConfig: config.repo.allowFile,
      bucket: resourcesBucket.bucket,
      contentType: 'application/json',
    });
    const denyFileObject = this.pushS3Object(this, 'denyFile', {
      assetConfig: config.repo.denyFile,
      bucket: resourcesBucket.bucket,
      contentType: 'application/json',
    });

    const initializeRepositoryFunc = this.setupLambda(this, 'aiaa-initialize-repo', {
      lambda: config.lambdas.initializeRepositoryConfig,
      bucket: resourcesBucket.bucket,
      environment: {
        variables: {
          CODECOMMIT_REPO_NAME: repo.repositoryName,
          CODECOMMIT_TARGET_BRANCH_NAME: mainBranchName,
          CODECOMMIT_REPO_FOLDER_PATH: '/',
          BUCKET_NAME: resourcesBucket.bucket,
          ALLOW_FILE_KEY: allowFileObject.key,
          DENY_FILE_KEY: denyFileObject.key,
        },
      },
      inlinePolicy: [
        {
          name: 'PolicyRepoAccess',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['codecommit:ListBranches', 'codecommit:CreateCommit'],
                Resource: repo.arn,
              },
            ],
          }),
        },
        {
          name: 'AssetsBucketAccess',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:GetObject*'],
                Resource: [
                  `${resourcesBucket.arn}/${allowFileObject.key}`,
                  `${resourcesBucket.arn}/${denyFileObject.key}`,
                ],
              },
            ],
          }),
        },
      ],
    });

    new LambdaInvocation(this, 'initialize-repo-invocation', {
      functionName: initializeRepositoryFunc.functionName,
      input: JSON.stringify({}),
    });

    const provideContextFunc = this.setupLambda(this, 'aiaa-provide-context', {
      lambda: config.lambdas.provideContext,
      bucket: resourcesBucket.bucket,
      environment: {
        variables: {
          DAYS: `${trailLookBackDays.numberValue}`,
        },
      },
    });

    const cloudTrailAccessorSuffix = new Id(this, 'cloud-trail-acessor-suffix', {
      byteLength: 8,
    });

    const cloudTrailAccessor = new IamRole(this, 'aiaa-cloud-trail-accessor', {
      name: `aiaa-cloud-trail-accessor-${cloudTrailAccessorSuffix.hex}`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'access-analyzer.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      inlinePolicy: [
        {
          name: 'cloudTrailAccess',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: 'cloudtrail:GetTrail',
                Resource: '*',
                Effect: 'Allow',
              },
              {
                Action: ['iam:GenerateServiceLastAccessedDetails', 'iam:GetServiceLastAccessedDetails'],
                Resource: '*',
                Effect: 'Allow',
              },
              {
                Action: ['s3:GetObject', 's3:ListBucket'],
                Resource: '*',
                Effect: 'Allow',
              },
            ],
          }),
        },
      ],
    });

    const flowRoleId = new Id(this, 'flow-role-id', {
      byteLength: 8,
    });

    const flowRole = new IamRole(this, 'flow-role', {
      name: `aiaa-flow-role-${flowRoleId.hex}`,
      assumeRolePolicy: JSON.stringify(sfnRolePolicy),
      inlinePolicy: [
        {
          name: 'flowPolicy',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: 'lambda:InvokeFunction',
                Resource: provideContextFunc.arn,
                Effect: 'Allow',
              },
              {
                Action: 'AccessAnalyzer:startPolicyGeneration',
                Resource: `arn:aws:access-analyzer:${region.stringValue}:${accountId.stringValue}:*`,
                Effect: 'Allow',
              },
              {
                Action: 'AccessAnalyzer:getGeneratedPolicy',
                Resource: `arn:aws:access-analyzer:${region.stringValue}:${accountId.stringValue}:*`,
                Effect: 'Allow',
              },
              {
                Action: 's3:putObject',
                Resource: `${dataBucket.arn}/*`,
                Effect: 'Allow',
              },
              {
                Action: 'iam:PassRole',
                Resource: `${cloudTrailAccessor.arn}`,
                Effect: 'Allow',
              },
              {
                Action: ['s3:DeleteObject*', 's3:PutObject', 's3:Abort*'],
                Resource: [`${dataBucket.arn}`, `${dataBucket.arn}/*`],
                Effect: 'Allow',
              },
              {
                Action: ['access-analyzer:StartPolicyGeneration', 'access-analyzer:GetGeneratedPolicy'],
                Resource: `arn:aws:access-analyzer:${region.stringValue}:${accountId.stringValue}:*`,
                Effect: 'Allow',
              },
            ],
          }),
        },
      ],
    });

    const flowId = new Id(this, 'aiaa-flow-id', {
      byteLength: 8,
    });

    const flow = new SfnStateMachine(this, 'aiaa-flow', {
      name: `aiaa-flow-${flowId.hex}`,
      roleArn: flowRole.arn,
      definition: `{
        "StartAt": "AutoIamAATestStackAaCtxProvider",
        "States": {
          "AutoIamAATestStackAaCtxProvider": {
            "Next": "AutoIamAATestStackAaIterateRoles",
            "Retry": [
              {
                "ErrorEquals": [
                  "Lambda.ServiceException",
                  "Lambda.AWSLambdaException",
                  "Lambda.SdkClientException"
                ],
                "IntervalSeconds": 2,
                "MaxAttempts": 6,
                "BackoffRate": 2
              }
            ],
            "Type": "Task",
            "ResultPath": "$.CloudTrailDetails",
            "ResultSelector": {
              "CloudTrailArn.$": "$$.Execution.Input.CloudTrailDetails.CloudTrailArn",
              "StartTime.$": "$.StartTime",
              "EndTime.$": "$.EndTime"
            },
            "Resource": "${provideContextFunc.arn}"
          },
          "AutoIamAATestStackAaIterateRoles": {
            "Type": "Map",
            "End": true,
            "Parameters": {
              "RoleArn.$": "$$.Map.Item.Value",
              "Index.$": "$$.Map.Item.Index",
              "CloudTrailDetails.$": "$.CloudTrailDetails"
            },
            "OutputPath": null,
            "Iterator": {
              "StartAt": "AutoIamAATestStackAaGeneratePolicy",
              "States": {
                "AutoIamAATestStackAaGeneratePolicy": {
                  "Next": "AutoIamAATestStackAaGetGeneratedPolicy",
                  "Type": "Task",
                  "OutputPath": "$.JobId",
                  "ResultPath": "$.JobId",
                  "Resource": "arn:aws:states:::aws-sdk:accessanalyzer:startPolicyGeneration",
                  "Parameters": {
                    "PolicyGenerationDetails": {
                      "PrincipalArn.$": "$.RoleArn"
                    },
                    "CloudTrailDetails": {
                      "AccessRole": "${cloudTrailAccessor.arn}",
                      "StartTime.$": "$.CloudTrailDetails.StartTime",
                      "EndTime.$": "$.CloudTrailDetails.EndTime",
                      "Trails": [
                        {
                          "AllRegions": true,
                          "CloudTrailArn.$": "$.CloudTrailDetails.CloudTrailArn"
                        }
                      ]
                    }
                  }
                },
                "AutoIamAATestStackAaGetGeneratedPolicy": {
                  "Next": "AutoIamAATestStackAaCheckStatus",
                  "Type": "Task",
                  "ResultPath": "$.JobResult",
                  "Resource": "arn:aws:states:::aws-sdk:accessanalyzer:getGeneratedPolicy",
                  "Parameters": {
                    "JobId.$": "$.JobId"
                  }
                },
                "AutoIamAATestStackAaWait": {
                  "Type": "Wait",
                  "Seconds": 60,
                  "Next": "AutoIamAATestStackAaGetGeneratedPolicy"
                },
                "AutoIamAATestStackAaCheckStatus": {
                  "Type": "Choice",
                  "Choices": [
                    {
                      "Variable": "$.JobResult.JobDetails.Status",
                      "StringEquals": "SUCCEEDED",
                      "Next": "AutoIamAATestStackAaForEachPolicy"
                    },
                    {
                      "Or": [
                        {
                          "Variable": "$.JobResult.JobDetails.Status",
                          "StringEquals": "FAILED"
                        },
                        {
                          "Variable": "$.JobResult.JobDetails.Status",
                          "StringEquals": "CANCELED"
                        }
                      ],
                      "Next": "AutoIamAATestStackAaProcessingFailed"
                    }
                  ],
                  "Default": "AutoIamAATestStackAaWait"
                },
                "AutoIamAATestStackAaForEachPolicy": {
                  "Type": "Map",
                  "ResultPath": "$.Policies",
                  "Next": "AutoIamAATestStackAaSavePolicyToS3",
                  "Parameters": {
                    "Policy.$": "States.StringToJson($$.Map.Item.Value.Policy)"
                  },
                  "Iterator": {
                    "StartAt": "AutoIamAATestStackAaPolicyRetriever",
                    "States": {
                      "AutoIamAATestStackAaPolicyRetriever": {
                        "Type": "Pass",
                        "OutputPath": "$.Policy",
                        "End": true
                      }
                    }
                  },
                  "ItemsPath": "$.JobResult.GeneratedPolicyResult.GeneratedPolicies"
                },
                "AutoIamAATestStackAaSavePolicyToS3": {
                  "End": true,
                  "Type": "Task",
                  "Resource": "arn:aws:states:::aws-sdk:s3:putObject",
                  "Parameters": {
                    "Bucket": "${dataBucket.bucket}",
                    "Key.$": "States.Format('{}/policy.json', $.JobResult.GeneratedPolicyResult.Properties.PrincipalArn)",
                    "Body.$": "$.Policies",
                    "ContentType": "application/json"
                  }
                },
                "AutoIamAATestStackAaProcessingFailed": {
                  "Type": "Fail"
                }
              }
            },
            "ItemsPath": "$.RoleArns"
          }
        }
      }`,
    });

    const flowInvokerRoleId = new Id(this, 'flow-invoker-role-id', {
      byteLength: 8,
    });

    const flowInvokerRole = new IamRole(this, 'flow-invoker-role', {
      name: `flow-invoker-role-${flowInvokerRoleId.hex}`,
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'events.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      inlinePolicy: [
        {
          name: 'invokeSfn',
          policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: 'states:StartExecution',
                Resource: flow.arn,
                Effect: 'Allow',
              },
            ],
          }),
        },
      ],
    });

    const flowRuleName = new Id(this, 'flow-rule-name', {
      byteLength: 8,
    });

    const rule = new CloudwatchEventRule(this, 'flow-rule', {
      name: `aiaa-flow-rule-${flowRuleName.hex}`,
      scheduleExpression: sched.stringValue,
    });

    new CloudwatchEventTarget(this, 'flow-rule-target', {
      rule: rule.name,
      roleArn: flowInvokerRole.arn,
      arn: flow.arn,
      input: JSON.stringify({
        RoleArns: [roleArns.stringValue],
        CloudTrailDetails: {
          CloudTrailArn: trailArn.stringValue,
        },
      }),
    });

    const bucketPermission = new LambdaPermission(this, 'bucket-lambda-permission', {
      statementId: 'AllowExecutionFromS3Bucket',
      action: 'lambda:InvokeFunction',
      functionName: pushPoliciesToRepoFunc.arn,
      principal: 's3.amazonaws.com',
      sourceArn: dataBucket.arn,
      sourceAccount: accountId.stringValue,
    });

    new S3BucketNotification(this, 'bucket-notification', {
      bucket: dataBucket.bucket,
      lambdaFunction: [
        {
          events: ['s3:ObjectCreated:*'],
          lambdaFunctionArn: pushPoliciesToRepoFunc.arn,
        },
      ],
      dependsOn: [bucketPermission],
    });

    new TerraformOutput(this, 'pushpoliciestoreponame', {
      value: pushPoliciesToRepoFunc.functionName,
    });

    new TerraformOutput(this, 'providecontextname', {
      value: provideContextFunc.functionName,
    });

    new TerraformOutput(this, 'flowName', {
      value: flow.name,
    });
  }

  // eslint-disable-next-line class-methods-use-this
  pushS3Object(
    scope: Construct,
    idPrefix: string,
    config: {
      assetConfig: S3AssetConfig;
      bucket: string;
      contentType?: string | undefined;
    }
  ) {
    const asset = new TerraformAsset(scope, `${idPrefix}-asset`, {
      path: path.resolve(__dirname, config.assetConfig.path),
      type: AssetType.FILE,
    });

    const s3Object = new S3BucketObject(scope, `${idPrefix}-object`, {
      bucket: config.bucket,
      key: `${config.assetConfig.version}/${idPrefix}/${asset.fileName}`,
      source: asset.path,
      contentType: config.contentType,
    });

    return s3Object;
  }

  setupLambda(
    scope: Construct,
    idPrefix: string,
    config: {
      lambda: LambdaFunctionConfig;
      bucket: string;
      environment?: LambdaFunctionEnvironment;
      inlinePolicy?: IamRoleInlinePolicy[] | undefined;
    }
  ) {
    const asset = new TerraformAsset(scope, `${idPrefix}-asset`, {
      path: path.resolve(__dirname, config.lambda.path),
      type: AssetType.ARCHIVE,
    });

    const archive = new S3BucketObject(scope, `${idPrefix}-archive`, {
      bucket: config.bucket,
      key: `${config.lambda.version}/${idPrefix}/${asset.fileName}`,
      source: asset.path,
    });

    const roleId = new Id(this, `${idPrefix}-role-name-suffix`, {
      byteLength: 8,
    });

    const role = new IamRole(scope, `${idPrefix}-role`, {
      name: `${idPrefix}-role-${roleId.hex}`,
      assumeRolePolicy: JSON.stringify(lambdaRolePolicy),
      inlinePolicy: config.inlinePolicy,
    });

    new IamRolePolicyAttachment(scope, `${idPrefix}-attachment`, {
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      role: role.name,
    });

    const funcId = new Id(this, `${idPrefix}-func-name-suffix`, {
      byteLength: 8,
    });

    const func = new LambdaFunction(scope, `${idPrefix}-func`, {
      functionName: `${idPrefix}-func-${funcId.hex}`,
      s3Bucket: config.bucket,
      s3Key: archive.key,
      handler: config.lambda.handler,
      runtime: config.lambda.runtime,
      timeout: 10,
      role: role.arn,
      environment: config.environment,
    });

    return func;
  }
}

const app = new App();

new AutomatedIamAccessAnalyzerStack(app, 'aiaa', {
  repo: {
    allowFile: {
      path: '../../repo/allow.json',
      version: 'v1.0.0',
    },
    denyFile: {
      path: '../../repo/deny.json',
      version: 'v1.0.0',
    },
  },
  lambdas: {
    provideContext: {
      path: '../../lambdas/provide-context/dist',
      handler: 'index.handler',
      runtime: 'nodejs14.x',
      version: 'v1.0.0',
    },
    pushPoliciesToRepositoryConfig: {
      path: '../../lambdas/push-policies-to-repository/dist',
      handler: 'index.handler',
      runtime: 'nodejs14.x',
      version: 'v1.0.0',
    },
    initializeRepositoryConfig: {
      path: '../../lambdas/initialize-repository/dist',
      handler: 'index.handler',
      runtime: 'nodejs14.x',
      version: 'v1.0.0',
    },
  },
});
app.synth();

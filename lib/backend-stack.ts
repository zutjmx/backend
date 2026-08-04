import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── 1. DynamoDB Table ────────────────────────────────────────────────────
    const vendorTable = new dynamodb.Table(this, 'VendorTable', {
      partitionKey: { name: 'vendorId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── 2. Lambda Functions ──────────────────────────────────────────────────
    const lambdaEnv = { TABLE_NAME: vendorTable.tableName };

    const createVendorLambda = new NodejsFunction(this, 'CreateVendorHandler', {
      entry: 'lambda/createVendor.ts',
      handler: 'handler',
      environment: lambdaEnv,
    });

    const getVendorsLambda = new NodejsFunction(this, 'GetVendorsHandler', {
      entry: 'lambda/getVendors.ts',
      handler: 'handler',
      environment: lambdaEnv,
    });

    const deleteVendorLambda = new NodejsFunction(this, 'DeleteVendorHandler', {
      entry: 'lambda/deleteVendor.ts',
      handler: 'handler',
      environment: lambdaEnv,
    });

    // ─── 3. Permissions ───────────────────────────────────────────────────────
    vendorTable.grantWriteData(createVendorLambda);
    vendorTable.grantReadData(getVendorsLambda);
    vendorTable.grantWriteData(deleteVendorLambda);

    // ─── 4. Cognito User Pool ─────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'VendorUserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
    });

    // Required to host Cognito's internal auth endpoints
    userPool.addDomain('VendorUserPoolDomain', {
      cognitoDomain: {
        domainPrefix: `vendor-tracker-${this.account}`,
      },
    });

    const userPoolClient = userPool.addClient('VendorAppClient');

    // ─── 5. API Gateway + Authorizer ──────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'VendorApi', {
      restApiName: 'Vendor Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'VendorAuthorizer',
      { cognitoUserPools: [userPool] }
    );

    const authOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const vendors = api.root.addResource('vendors');
    vendors.addMethod('GET', new apigateway.LambdaIntegration(getVendorsLambda), authOptions);
    vendors.addMethod('POST', new apigateway.LambdaIntegration(createVendorLambda), authOptions);
    vendors.addMethod('DELETE', new apigateway.LambdaIntegration(deleteVendorLambda), authOptions);

    // ─── 6. Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiEndpoint', { value: api.url });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
  }
}

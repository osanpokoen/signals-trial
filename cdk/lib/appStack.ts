import { Construct } from "constructs";
import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDriver,
  LogDrivers,
  OperatingSystemFamily,
  Secret,
} from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { Repository } from "aws-cdk-lib/aws-ecr";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";

type Props = StackProps & {
  repository: Repository;
};

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // props
    const { repository } = props;

    // roles
    const executionRole = new Role(this, `${id}EcsExecutionRole`, {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });
    const taskRole = new Role(this, `${id}EcsTaskRole`, {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMFullAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
      ],
    });

    // log group
    const logGroup = new LogGroup(this, `${id}LogGroup`, {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // task definition
    const taskDefinition = new FargateTaskDefinition(this, `${id}TaskDef`, {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    // main container
    const mainContainer = taskDefinition.addContainer(`${id}Container`, {
      image: ContainerImage.fromEcrRepository(repository, "latest"),
      logging: LogDriver.awsLogs({ streamPrefix: "FlaskApp", logGroup }),
      environment: {
        OTEL_RESOURCE_ATTRIBUTES: `service.name=APM_SAMPLE,aws.log.group.names=${logGroup.logGroupName}`,
        OTEL_AWS_APPLICATION_SIGNALS_ENABLED: "true",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_AWS_APPLICATION_SIGNALS_EXPORTER_ENDPOINT:
          "http://127.0.0.1:4316/v1/metrics",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4316/v1/traces",
        OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
        OTEL_TRACES_SAMPLER_ARG: "0.05",
        OTEL_PYTHON_DISTRO: "aws_distro",
        OTEL_PYTHON_CONFIGURATOR: "aws_configurator",
        PYTHONPATH:
          "/otel-auto-instrumentation-python/opentelemetry/instrumentation/auto_instrumentation:/usr/src/app:/otel-auto-instrumentation-python",
        OTEL_PYTHON_LOG_LEVEL: "debug",
      },
    });
    mainContainer.addPortMappings({
      containerPort: 80,
    });
    mainContainer.addMountPoints({
      sourceVolume: "opentelemetry-auto-instrumentation-python",
      containerPath: "/otel-auto-instrumentation-python",
      readOnly: false,
    });
    taskDefinition.addVolume({
      name: "opentelemetry-auto-instrumentation-python",
    });

    // CloudWatch Agent container
    taskDefinition.addContainer(`${id}CwAgentContainer`, {
      image: ContainerImage.fromRegistry(
        "public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest-arm64"
      ),
      secrets: {
        CW_CONFIG_CONTENT: Secret.fromSsmParameter(
          StringParameter.fromStringParameterName(
            this,
            "CwConfigContent",
            "flask-cw-agent"
          )
        ),
      },
      logging: LogDrivers.awsLogs({
        streamPrefix: "FlaskCwAgent",
        logGroup: new LogGroup(this, `${id}CwAgentLogGroup`, {
          logGroupName: "/ecs/ecs-cw-agent",
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      }),
    });

    // Init container
    taskDefinition
      .addContainer("InitContainer", {
        image: ContainerImage.fromRegistry(
          "public.ecr.aws/aws-observability/adot-autoinstrumentation-python:v0.5.0"
        ),
        essential: false,
        command: [
          "cp",
          "-a",
          "/autoinstrumentation/.",
          "/otel-auto-instrumentation-python",
        ],
        logging: LogDrivers.awsLogs({
          streamPrefix: "FlaskInit",
          logGroup: new LogGroup(this, `${id}InitLogGroup`, {
            logGroupName: "/ecs/ecs-init",
            removalPolicy: RemovalPolicy.DESTROY,
          }),
        }),
      })
      .addMountPoints({
        sourceVolume: "opentelemetry-auto-instrumentation-python",
        containerPath: "/otel-auto-instrumentation-python",
        readOnly: false,
      });

    // service
    new ApplicationLoadBalancedFargateService(this, "FlaskServer", {
      desiredCount: 1,
      taskDefinition,
      publicLoadBalancer: true,
    });
  }
}

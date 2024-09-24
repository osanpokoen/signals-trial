import { Stack, StackProps } from "aws-cdk-lib";
import { Repository, TagMutability } from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs/lib/construct";

export class ECRStack extends Stack {
  public readonly repository: Repository;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.repository = new Repository(this, "FlaskApp", {
      repositoryName: "flask-app",
      imageTagMutability: TagMutability.MUTABLE,
    });
    this.repository.addLifecycleRule({ maxImageCount: 3 });
  }
}

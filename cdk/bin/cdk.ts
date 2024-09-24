#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ECRStack } from "../lib/ecrStack";
import { AppStack } from "../lib/appStack";

const app = new cdk.App();
const ecrStack = new ECRStack(app, "ECRStack");
new AppStack(app, "AppStack", { repository: ecrStack.repository });

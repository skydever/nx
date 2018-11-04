import { UnitTestRunner } from '../../utils/test-runners';

export interface Schema {
  name: string;
  skipFormat: boolean;
  directory?: string;
  sourceDir?: string;
  publishable: boolean;
  module: boolean;
  moduleName?: string;

  spec?: boolean;
  flat?: boolean;
  commonModule?: boolean;

  prefix?: string;
  routing?: boolean;
  lazy?: boolean;
  parentModule?: string;
  tags?: string;

  unitTestRunner: UnitTestRunner;
}

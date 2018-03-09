import { RuleFailure } from 'tslint';
import * as ts from 'typescript';

import { Rule } from './nxEnforceModuleBoundariesRule';

describe('Enforce Module Boundaries', () => {
  it('should not error when everything is in order', () => {
    const failures = runRule(
      { allow: ['@mycompany/libgroup/mylib/deep'], lazyLoad: ['myliblazy'] },
      `
      import '@mycompany/libgroup/mylib';
      import '@mycompany/libgroup/mylib/deep';
      import '../blah';
    `
    );

    expect(failures.length).toEqual(0);
  });

  describe('relative imports', () => {
    it('should not error when relatively importing the same library', () => {
      const failures = runRuleToCheckForRelativeImport('import "../libgroup/mylib2"');
      expect(failures.length).toEqual(0);
    });

    it('should not error when relatively importing the same library (index file)', () => {
      const failures = runRuleToCheckForRelativeImport('import "../../libgroup/mylib"');
      expect(failures.length).toEqual(0);
    });

    it('should error when relatively importing another library', () => {
      const failures = runRuleToCheckForRelativeImport('import "../../../../libs/libgroup/mylib2"');
      expect(failures.length).toEqual(1);
      expect(failures[0].getFailure()).toEqual('library imports must start with @mycompany/');
    });

    it('should error on a relatively importing another library (in the same dir)', () => {
      const failures = runRuleToCheckForRelativeImport('import "../../../libgroup/mylib2"');
      expect(failures.length).toEqual(1);
      expect(failures[0].getFailure()).toEqual('library imports must start with @mycompany/');
    });
  });

  it('should error on absolute imports into libraries without using the npm scope', () => {
    const failures = runRule({}, `import 'libs/libgroup/mylib';`);

    expect(failures.length).toEqual(1);
    expect(failures[0].getFailure()).toEqual('library imports must start with @mycompany/');
  });

  it('should error about deep imports into libraries', () => {
    const failures = runRule({}, `import '@mycompany/libgroup/mylib/blah';`);

    expect(failures.length).toEqual(1);
    expect(failures[0].getFailure()).toEqual('deep imports into libraries are forbidden');
  });

  it('should not error about deep imports when libs contain the same prefix', () => {
    let failures = runRule(
      {},
      `import '@mycompany/reporting-dashboard-ui';
       import '@mycompany/reporting-other';
       import '@mycompany/reporting';
       `,
      ['reporting', 'reporting-dashboard-ui'],
      [],
      ['libs/reporting', 'libs/reporting-other', 'libs/reporting-dashboard-ui']
    );

    expect(failures.length).toEqual(0);

    // Make sure it works regardless of order of lib/root names list
    failures = runRule(
      {},
      `import '@mycompany/reporting-dashboard-ui';
       import '@mycompany/reporting-other';
       import '@mycompany/reporting';`,
      ['reporting-dashboard-ui', 'reporting'],
      [],
      ['libs/reporting-dashboard-ui', 'libs/reporting-other', 'libs/reporting']
    );

    expect(failures.length).toEqual(0);
  });

  it('should error on importing a lazy-loaded library', () => {
    const failures = runRule({ lazyLoad: ['libgroup/mylib'] }, `import '@mycompany/libgroup/mylib';`);

    expect(failures.length).toEqual(1);
    expect(failures[0].getFailure()).toEqual('imports of lazy-loaded libraries are forbidden');
  });

  it('should error on importing an app (using npmScope)', () => {
    const failures = runRule({ lazyLoad: ['libgroup/mylib'] }, `import '@mycompany/myapp';`);

    expect(failures.length).toEqual(1);
    expect(failures[0].getFailure()).toEqual('imports of apps are forbidden');
  });

  it('should not error on importing a lib that has the same prefix as an app', () => {
    const noFailures = runRule({ 
      lazyLoad: [] }, 
      `import '@mycompany/myapp/mylib';`, 
      ['myapp/mylib'], 
      ['myapp'],
      ['libs/myapp/mylib', 'apps/myapp']);

    expect(noFailures.length).toEqual(0);
  });
});

function runRule(
  ruleArguments: any,
  content: string,
  libNames: string[] = ['libgroup/mylib', 'libgroup/mylib2', 'libgroup/myliblazy'],
  appNames: string[] = ['myapp', 'myapp2'],
  roots: string[] = ['libs/libgroup/mylib', 'libs/libgroup/mylib2', 'apps/myapp', 'apps/myapp2']
): RuleFailure[] {
  const options: any = {
    ruleArguments: [ruleArguments],
    ruleSeverity: 'error',
    ruleName: 'enforceModuleBoundaries'
  };

  const sourceFile = ts.createSourceFile(
    '/proj/mycompany/apps/myapp/src/main.ts',
    content,
    ts.ScriptTarget.Latest,
    true
  );
  const rule = new Rule(options, '/proj/mycompany', 'mycompany', libNames, appNames, roots);
  return rule.apply(sourceFile);
}

function runRuleToCheckForRelativeImport(content: string): RuleFailure[] {
  const options: any = {
    ruleArguments: [{}],
    ruleSeverity: 'error',
    ruleName: 'enforceModuleBoundaries'
  };

  const sourceFile = ts.createSourceFile(
    '/proj/mycompany/libs/libgroup/mylib/src/module.t',
    content,
    ts.ScriptTarget.Latest,
    true
  );
  const rule = new Rule(
    options,
    '/proj/mycompany',
    'mycompany',
    ['libgroup/mylib', 'libgroup/mylib2', 'libgroup/myliblazy'],
    ['myapp', 'myapp2'],
    ['libs/libgroup/mylib', 'libs/libgroup/mylib2', 'apps/myapp', 'apps/myapp2']
  );
  return rule.apply(sourceFile);
}

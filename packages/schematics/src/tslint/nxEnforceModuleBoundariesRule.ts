import * as path from 'path';
import * as Lint from 'tslint';
import { IOptions } from 'tslint';
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import * as appRoot from 'app-root-path';
import * as minimatch from 'minimatch';

export class Rule extends Lint.Rules.AbstractRule {
  /**
   * 
   * @param options lint rule options
   * 
   * example:
   * 
   * {
   *    "disabledIntervals":[],
   *    "ruleArguments":[
   *       {
   *          "lazyLoad":[
   *             "myliblazy"
   *          ],
   *          "allow":[
   *             "@myworkspace/mylib/src/lib-one-deep.service"
   *          ]
   *       }
   *    ],
   *    "ruleName":"nx-enforce-module-boundaries",
   *    "ruleSeverity":"error"
   * }
   * 
   * @param projectPath absolute path to project
   * 
   * example: "/projects/myworkspace" or "c:\\projects\\myworkspace" (win)
   * 
   * @param npmScope project.npmScope defined in .angular-cli.json
   * 
   * example: myworkspace
   * 
   * @param libNames list of lib names defined in .angular-cli.json
   * 
   * example: ["mylib", "libgroup/mylib"]
   * 
   * @param appNames list of app names defined in .angular-cli.json
   * 
   * example: ["myapp", "appgroup/myapp"]
   * 
   * @param roots paths of apps/libs defined in .angular-cli.json
   * 
   * example: ["apps/myapp", "apps/appgroup/myapp", "libs/mylib", "libs/libgroup/mylib"]
   * 
   */
  constructor(
    options: IOptions,
    private readonly projectPath?: string,
    private readonly npmScope?: string,
    private readonly libNames?: string[],
    private readonly appNames?: string[],
    private readonly roots?: string[]
  ) {
    super(options);
    if (!projectPath) {
      this.projectPath = appRoot.path;
      const cliConfig = this.readCliConfig(this.projectPath);
      this.npmScope = cliConfig.project.npmScope;
      this.libNames = cliConfig.apps.filter(p => p.root.startsWith('libs/')).map(a => a.name);
      this.appNames = cliConfig.apps.filter(p => p.root.startsWith('apps/')).map(a => a.name);
      this.roots = cliConfig.apps.map(a => path.dirname(a.root));
    }
  }

  public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
    return this.applyWithWalker(
      new EnforceModuleBoundariesWalker(
        sourceFile,
        this.getOptions(),
        this.projectPath,
        this.npmScope,
        this.libNames,
        this.appNames,
        this.roots
      )
    );
  }

  private readCliConfig(projectPath: string): any {
    return JSON.parse(readFileSync(`${projectPath}/.angular-cli.json`, 'UTF-8'));
  }
}

class EnforceModuleBoundariesWalker extends Lint.RuleWalker {
  constructor(
    sourceFile: ts.SourceFile,
    options: IOptions,
    private projectPath: string,
    private npmScope: string,
    private libNames: string[],
    private appNames: string[],
    private roots: string[]
  ) {
    super(sourceFile, options);
    // os compatibility
    this.projectPath = this.normalizePath(projectPath);
    // sort from longest to shortest to avoid name collision
    this.roots = [...roots].sort((a, b) => b.length - a.length);
  }

  public visitImportDeclaration(node: ts.ImportDeclaration) {
    // imp: the import (example: "@myworkspace/mylib", "../comp/comp.component")
    const imp = node.moduleSpecifier.getText().substring(1, node.moduleSpecifier.getText().length - 1);
    // lazy loaded lib names from rule options (example: "mylib", "libgroup/mylib")
    const lazyLoad: string[] = Array.isArray(this.getOptions()[0].lazyLoad)
      ? this.getOptions()[0].lazyLoad.map(a => `${a}`)
      : [];
    // nx root (lib or app) of source file that is importing
    const sourceRoot = this.sourceRoot();
    // nx root (lib or app) of imported file
    const targetRoot = this.targetRoot(imp);

    // whitelisted import => return
    if (this.isWhitelisted(imp)) {
      super.visitImportDeclaration(node);
      return;
    }

    // relative using npmScope is forbidden
    if (imp.startsWith(`@${this.npmScope}/.`)) {
      this.addError(node, `relative imports using @${this.npmScope}/ are forbidden`);
      return;
    }

    // source or target is not part of nx app/lib or relative import into same nx app/lib => return
    if (!sourceRoot || !targetRoot || (this.isRelative(imp) && sourceRoot === targetRoot)) {
      super.visitImportDeclaration(node);
      return;
    }

    // absolute import into same nx app/lib is allowed (agree? @todo define a rule option)
    if ((imp.startsWith('apps/') || imp.startsWith('libs/')) && sourceRoot === targetRoot) {
      super.visitImportDeclaration(node);
      return;
    }

    // imports of other apps are forbidden
    if (targetRoot.startsWith('apps/') && sourceRoot !== targetRoot) {
      this.addError(node, 'imports of apps are forbidden');
      return;
    }

    // imports of lazy-loaded libs are forbidden
    const lazyLoaded = lazyLoad.filter(
      l => imp.startsWith(`@${this.npmScope}/${l}/`) || imp === `@${this.npmScope}/${l}`
    )[0];
    if (lazyLoaded) {
      this.addError(node, 'imports of lazy-loaded libraries are forbidden');
      return;
    }

    // deep imports of other libs are forbidden
    const deepImport = this.libNames.filter(l => imp.startsWith(`@${this.npmScope}/${l}/`))[0];
    if (deepImport) {
      this.addError(node, 'deep imports into libraries are forbidden');
      return;
    }

    // relative imports of other libs are forbidden
    if (!(this.libNames.filter(l => imp === `@${this.npmScope}/${l}`).length > 0)) {
      if (this.appNames.filter(a => imp === `@${this.npmScope}/${a}`).length > 0) {
        this.addError(node, 'imports of apps are forbidden');
      } else {
        this.addError(node, `library imports must start with @${this.npmScope}/`);
      }
      return;
    }

    super.visitImportDeclaration(node);
  }

  private isWhitelisted(imp: string): boolean {
    // allow: whitelisted imports from rule options (glob support)
    const allow: string[] = Array.isArray(this.getOptions()[0].allow)
    ? this.getOptions()[0].allow.map(a => `${a}`)
    : [];
    return (allow.filter(a => minimatch(imp, a)).length > 0);
  }

  private sourceRoot(): string {
    /**
     * this.getSourceFile().fileName: absolute path to file
     * 
     * example:
     * 
     * "/projects/myworkspace/apps/myapp/src/app/app.module.ts"
     * or
     * "c:/projects/myworkspace/apps/myapp/src/app/app.module.ts" 
     *  (win, notice the "/" as separator)
     * 
     */
    return this.getRoot(this.getSourceFile().fileName);
  }

  private targetRoot(imp: string): string {
    let targetFile = imp;

    if (this.isRelative(imp)) {
      targetFile = this.normalizePath(path.resolve(path.dirname(this.getSourceFile().fileName), imp));      
    } else if (imp.startsWith(`@${this.npmScope}/`)) {
      targetFile = this.normalizePath(imp.replace(`@${this.npmScope}`, `${this.projectPath}/libs`));
      if (!this.getRoot(targetFile))
        targetFile = this.normalizePath(imp.replace(`@${this.npmScope}`, `${this.projectPath}/apps`));
    }

    return this.getRoot(targetFile);;
  }

  private getRoot(fileOrDir: string): string {
    /**
     * fileOrDir: path fo file/dir starting from project root
     * (example: "apps/myapp/src/app/app.module.ts")
     */
    let projectFileOrDir = this.normalizePath(fileOrDir.replace(this.projectPath, ''));
    projectFileOrDir = projectFileOrDir.startsWith('/') ? projectFileOrDir.substring(1) : projectFileOrDir;

    return this.roots.filter(r => projectFileOrDir.startsWith(r))[0];
  }

  private normalizePath(pathToNormalize: string): string {
    return pathToNormalize.split(path.sep).join('/');
  }

  private isRelative(s: string): boolean {
    return s.startsWith('.');
  }

  private addError(node: ts.ImportDeclaration, message: string) {
    this.addFailureAt(node.getStart(), node.getWidth(), message);
  }
}

import * as path from 'path';
import * as Lint from 'tslint';
import { IOptions } from 'tslint';
import * as ts from 'typescript';
import { readFileSync } from 'fs';
import * as appRoot from 'app-root-path';

export class Rule extends Lint.Rules.AbstractRule {
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
    // sort from longest to shortest to avoid name collision
    this.roots = [...roots].sort((a, b) => b.length - a.length);
  }

  public visitImportDeclaration(node: ts.ImportDeclaration) {
    const imp = node.moduleSpecifier.getText().substring(1, node.moduleSpecifier.getText().length - 1);
    const allow: string[] = Array.isArray(this.getOptions()[0].allow)
      ? this.getOptions()[0].allow.map(a => `${a}`)
      : [];
    const lazyLoad: string[] = Array.isArray(this.getOptions()[0].lazyLoad)
      ? this.getOptions()[0].lazyLoad.map(a => `${a}`)
      : [];
    const sourceRoot = this.sourceRoot();
    const targetRoot = this.targetRoot(imp);

    // whitelisted import => return
    if (allow.indexOf(imp) > -1) {
      super.visitImportDeclaration(node);
      return;
    }

    // relative using npmScope is forbidden
    if (imp.startsWith(`@${this.npmScope}/.`)) {
      this.addFailureAt(node.getStart(), node.getWidth(), `relative imports using @${this.npmScope}/ are forbidden`);
      return;
    }

    // source or target is not part of nx app/lib or import into same nx app/lib => return
    if (!sourceRoot || !targetRoot || (this.isRelative(imp) && sourceRoot === targetRoot)) {
      super.visitImportDeclaration(node);
      return;
    }

    // absolute import into same nx app/lib is allowed (agree?)
    if ((imp.startsWith('apps/') || imp.startsWith('libs/')) && sourceRoot === targetRoot) {
      super.visitImportDeclaration(node);
      return;
    }

    if (targetRoot.startsWith('apps/')) {
      this.addFailureAt(node.getStart(), node.getWidth(), 'imports of apps are forbidden');
      return;
    }

    const lazyLoaded = lazyLoad.filter(
      l => imp.startsWith(`@${this.npmScope}/${l}/`) || imp === `@${this.npmScope}/${l}`
    )[0];
    if (lazyLoaded) {
      this.addFailureAt(node.getStart(), node.getWidth(), 'imports of lazy-loaded libraries are forbidden');
      return;
    }

    const deepImport = this.libNames.filter(l => imp.startsWith(`@${this.npmScope}/${l}/`))[0];
    if (deepImport) {
      this.addFailureAt(node.getStart(), node.getWidth(), 'deep imports into libraries are forbidden');
      return;
    }

    if (!(this.libNames.filter(l => imp === `@${this.npmScope}/${l}`).length > 0)) {
      this.addFailureAt(node.getStart(), node.getWidth(), `library imports must start with @${this.npmScope}/`);
      return;
    }

    super.visitImportDeclaration(node);
  }

  private sourceRoot(): string {
    const sourceFile = this.getSourceFile().fileName.substring(this.projectPath.length + 1);
    return this.roots.filter(r => sourceFile.startsWith(r))[0];
  }

  private targetRoot(imp: string): string {
    if (this.isRelative(imp)) {
      const targetFile = path.resolve(path.dirname(this.getSourceFile().fileName), imp)
        .substring(this.projectPath.length + 1)
        .split(path.sep)
        .join('/');
      return this.roots.filter(r => targetFile.startsWith(r))[0];
    } else if (imp.startsWith(`@${this.npmScope}/`)) {
      const impNoScope = imp.substring(this.npmScope.length + 1);
      return this.roots.filter(r => impNoScope.startsWith(r.substring(r.indexOf('/'))))[0];
    } else if (imp.startsWith('apps/') || imp.startsWith('libs/')) {
      return this.roots.filter(r => imp.startsWith(`${r}/`) || imp === r)[0];
    }

    return '';
  }

  private isRelative(s: string): boolean {
    return s.startsWith('.');
  }
}

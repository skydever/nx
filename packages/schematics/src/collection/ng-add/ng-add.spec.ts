import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import * as path from 'path';
import { Tree, VirtualTree } from '@angular-devkit/schematics';
import { readJsonInTree } from '@nrwl/schematics/src/utils/ast-utils';

describe('workspace', () => {
  const schematicRunner = new SchematicTestRunner(
    '@nrwl/schematics',
    path.join(__dirname, '../../collection.json')
  );

  let appTree: Tree;

  beforeEach(() => {
    appTree = new VirtualTree();
  });

  it('should error if no package.json is present', () => {
    expect(() => {
      schematicRunner.runSchematic('ng-add', { name: 'myApp' }, appTree);
    }).toThrow('Cannot find package.json');
  });

  it('should error if no e2e/protractor.conf.js is present', () => {
    expect(() => {
      appTree.create('/package.json', JSON.stringify({}));
      appTree.create(
        '/angular.json',
        JSON.stringify({
          projects: {
            proj1: {
              architect: {}
            },
            'proj1-e2e': {
              architect: {
                e2e: {
                  options: {
                    protractorConfig: 'e2e/protractor.conf.js'
                  }
                }
              }
            }
          }
        })
      );
      schematicRunner.runSchematic('ng-add', { name: 'proj1' }, appTree);
    }).toThrow(
      'An e2e project was specified but e2e/protractor.conf.js could not be found.'
    );
  });

  it('should error if no angular.json is present', () => {
    expect(() => {
      appTree.create('/package.json', JSON.stringify({}));
      appTree.create('/e2e/protractor.conf.js', '');
      schematicRunner.runSchematic('ng-add', { name: 'myApp' }, appTree);
    }).toThrow('Cannot find angular.json');
  });

  it('should error if the angular.json specifies more than one app', () => {
    appTree.create('/package.json', JSON.stringify({}));
    appTree.create('/e2e/protractor.conf.js', '');
    appTree.create(
      '/angular.json',
      JSON.stringify({
        projects: {
          proj1: {},
          'proj1-e2e': {},
          proj2: {},
          'proj2-e2e': {}
        }
      })
    );
    expect(() => {
      schematicRunner.runSchematic('ng-add', { name: 'proj1' }, appTree);
    }).toThrow('Can only convert projects with one app');
  });

  it('should convert all fileReplacement paths in angular.json', () => {
    appTree.create('/package.json', JSON.stringify({}));
    appTree.create('/e2e/protractor.conf.js', '');
    appTree.create(
      '/angular.json',
      JSON.stringify({
        projects: {
          proj1: {
            sourceRoot: 'src',
            projectType: 'application',
            architect: {
              build: {
                configurations: {
                  dev: {
                    fileReplacements: {
                      replace: 'src/environments/environment.ts',
                      with: 'src/environments/environment.dev.ts'
                    }
                  },
                  staging: {
                    fileReplacements: {
                      replace: 'src/environments/environment.ts',
                      with: 'src/environments/environment.staging.ts'
                    }
                  },
                  production: {
                    fileReplacements: {
                      replace: 'src/environments/environment.ts',
                      with: 'src/environments/environment.prod.ts'
                    }
                  }
                }
              }
            }
          }
        }
      })
    );
    const resultTree = schematicRunner.runSchematic(
      'ng-add',
      { name: 'proj1' },
      appTree
    );
    const angularJson = readJsonInTree(resultTree, 'angular.json');
    expect(angularJson).toEqual({
      projects: {
        proj1: {
          sourceRoot: 'src',
          projectType: 'application',
          architect: {
            build: {
              configurations: {
                dev: {
                  fileReplacements: {
                    replace: 'apps/proj1/src/environments/environment.ts',
                    with: 'apps/proj1/src/environments/environment.dev.ts'
                  }
                },
                staging: {
                  fileReplacements: {
                    replace: 'apps/proj1/src/environments/environment.ts',
                    with: 'apps/proj1/src/environments/environment.staging.ts'
                  }
                },
                production: {
                  fileReplacements: {
                    replace: 'apps/proj1/src/environments/environment.ts',
                    with: 'apps/proj1/src/environments/environment.prod.ts'
                  }
                }
              }
            }
          }
        }
      }
    });
  });
});
